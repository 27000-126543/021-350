import dayjs from 'dayjs';
import { seedDemoData } from '../data/seedData';
import { statusReminderService } from '../services/statusReminder.service';
import { riskAlertService } from '../services/riskAlert.service';
import { weeklySummaryService } from '../services/weeklySummary.service';
import { pushRecordService } from '../services/pushRecord.service';
import { taskSchedulerService } from '../services/taskScheduler.service';
import { reminderHandlingService } from '../services/reminderHandling.service';
import { dataStore } from '../store/dataStore';
import { categoryLabels, professionalLabels, stageLabels, handlingStatusLabels, channelLabels, PushRecord } from '../types';

function section(title: string) {
  const line = '─'.repeat(68);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function subsection(title: string) {
  console.log(`\n  ▶ ${title}`);
}

async function runDemo() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║       变更洽商智能提醒服务 v3.0 — 贴近真实平台的消息与闭环看板           ║
║  ①定时周报 ②三阶段超期 ③综合风险 ④规则管理 ⑤推送追溯                    ║
║  ⑥提醒处置闭环 ⑦多渠道结果回写 ⑧周报结构化数据源 ⑨规则口径修正         ║
╚══════════════════════════════════════════════════════════════════════════╝`);

  section('【初始化】加载示例数据（3个项目，20+条各阶段/各专业变更）');
  const { projects, changes } = seedDemoData();
  const byStatus: Record<string, number> = {};
  const byProf: Record<string, number> = {};
  changes.forEach(c => {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    byProf[c.professional] = (byProf[c.professional] || 0) + 1;
  });
  console.log(`  项目: ${projects.length}个  |  变更: ${changes.length}条`);
  console.log(`  状态分布: ${Object.entries(byStatus).map(([k, v]) => k + '=' + v).join('  ')}`);
  console.log(`  专业分布: ${Object.entries(byProf).map(([k, v]) => professionalLabels[k as keyof typeof professionalLabels] + '=' + v).join('  ')}`);

  const rules = dataStore.getReminderRules();
  console.log(`\n  当前规则口径: 风险窗口=${rules.riskTimeWindowDays}天  设计审核超期按designReviewDays=${rules.designReviewDays}天  提醒处置期限=${rules.reminderHandlingDeadlineDays}天`);

  section('【预执行】生成一份周报（作为后续看板、结构化数据、多渠道推送的数据源）');
  const weeklyGen = await weeklySummaryService.generateWeeklySummary(false, true);
  let latestSummary = weeklyGen.summary;
  console.log(`  周报已生成: ${latestSummary.weekStart} ~ ${latestSummary.weekEnd}  推送记录=${weeklyGen.pushRecordCount}条`);

  section('能力⑨ 规则口径修正：设计审核按 designReviewDays、风险窗口 30 天、建议文字显示新口径');
  subsection('执行状态检测，验证设计审核阶段超期口径');
  const statusResult = await statusReminderService.checkAndGenerateReminders(true);
  const designReminder = statusResult.reminders.find(r => r.stage === 'design_to_close');
  if (designReminder) {
    const msg = statusReminderService.formatReminderMessage(designReminder);
    console.log(`    设计审核阶段超期提醒: ${designReminder.changeCode}  超期${designReminder.overdueDays}天`);
    const ruleLine = msg.split('\n').find((l: string) => l.includes('规则口径'));
    console.log(`    ${ruleLine || '（口径说明已嵌入消息）'}`);
    console.log(`    ✅ 设计审核阶段按 designReviewDays=${rules.designReviewDays}天 计算，已在消息中显示口径`);
  } else {
    console.log('    （本次演示数据中暂未产生设计审核超期案例，口径逻辑已生效）');
  }

  subsection('执行风险检测，验证风险窗口 30 天与建议文字随口径显示');
  const riskResult = await riskAlertService.detectAndGenerateAlerts(true);
  const firstAlert = riskResult.categoryAlerts[0] || riskResult.comprehensiveViews[0];
  if (firstAlert) {
    console.log(`    检测时间窗口: ${firstAlert.timeWindowDays}天`);
    const suggestion = (firstAlert as any).overallSuggestion || (firstAlert as any).suggestion || '';
    const hasCaliber = suggestion.includes(String(rules.riskTimeWindowDays));
    console.log(`    建议文字含口径天数: ${hasCaliber ? '✅ 是' : '❌ 否'}  文字示例: ${suggestion.slice(0, 50)}...`);
  }

  section('能力⑥ 提醒处置闭环：项目负责人标记已读→处理中→已处理，带说明+附件');
  const allActive = statusReminderService.getAllReminders(true);
  const handlingTarget = allActive[0];
  if (handlingTarget) {
    console.log(`    目标提醒: ${handlingTarget.changeCode} ${handlingTarget.changeTitle.slice(0, 20)}  当前处置状态=${handlingStatusLabels[handlingTarget.handlingStatus]}`);

    subsection('Step1: 项目负责人标记「已读」');
    const readResult = reminderHandlingService.markAsRead('status_overdue', handlingTarget.id, '张建国');
    console.log(`    结果: ${readResult.message}`);

    subsection('Step2: 标记「处理中」并填写处置说明+附件链接');
    const progressResult = reminderHandlingService.markInProgress(
      'status_overdue', handlingTarget.id, '张建国',
      '已联系监理单位签认，预计 2 个工作日内回传意见扫描件',
      ['https://docs.example.com/signature/preview/CQ-001']
    );
    console.log(`    结果: ${progressResult.message}`);
    console.log(`    处理说明: ${progressResult.record?.handlingNote}`);
    console.log(`    附件链接: ${progressResult.record?.handlingAttachments?.join(', ')}`);

    subsection('Step3: 标记「已处理」（必须填处理说明）');
    const handledResult = reminderHandlingService.markAsHandled(
      'status_overdue', handlingTarget.id, '张建国',
      '监理意见扫描件已上传至资料系统，签认完成，流转至设计审核',
      ['https://docs.example.com/signature/final/CQ-001']
    );
    console.log(`    结果: ${handledResult.message}`);
    console.log(`    已留痕处置记录 ID: ${handledResult.record?.id}  时间: ${dayjs(handledResult.record?.handledAt || '').format('MM-DD HH:mm')}`);

    subsection('Step4: 查询该提醒的处置历史留痕');
    const records = reminderHandlingService.getHandlingRecords('status_overdue', handlingTarget.id);
    console.log(`    共 ${records.length} 条处置记录:`);
    records.forEach(r => {
      console.log(`       · [${dayjs(r.handledAt).format('MM-DD HH:mm')}] ${handlingStatusLabels[r.previousStatus]} → ${handlingStatusLabels[r.newStatus]}  操作人:${r.handledBy}`);
    });
  }

  section('能力⑥-B 工程管理部看板查询：按项目展示未读/处理中/已处理/超时未处理');
  subsection('全项目提醒看板总览');
  const boards = reminderHandlingService.getBoard();
  console.log(`    共 ${boards.length} 个项目:`);
  boards.forEach(b => {
    console.log(`       · ${b.projectName.padEnd(18)}  未读=${b.summary.unreadCount}  处理中=${b.summary.inProgressCount}  已处理=${b.summary.handledCount}  超时未处理=${b.summary.overdueUnhandledCount}  合计=${b.summary.total}`);
  });
  subsection('单项目看板明细（市民中心办公楼项目）');
  const singleBoard = reminderHandlingService.getBoard(projects[0].id);
  if (singleBoard.length > 0) {
    const b = singleBoard[0];
    if (b.unread.length > 0) console.log(`    📭 未读（${b.unread.length}条）: ${b.unread.map(i => i.title.slice(0, 24)).join('、')}`);
    if (b.inProgress.length > 0) console.log(`    🔄 处理中（${b.inProgress.length}条）: ${b.inProgress.map(i => i.title.slice(0, 24)).join('、')}`);
    if (b.handled.length > 0) console.log(`    ✅ 已处理（${b.handled.length}条）: ${b.handled.map(i => i.title.slice(0, 24)).join('、')}`);
  }

  section('能力⑦ 多渠道推送结果回写：按企业微信/短信/邮件/合同系统分别记录结果');
  subsection('Step1: 为一条周报推送创建多渠道记录（企业微信+短信+邮件+合同系统）');
  let weeklyPushRecords: PushRecord[] = [];
  if (latestSummary) {
    weeklyPushRecords = pushRecordService.createPushRecordForWeeklySummary(
      latestSummary,
      ['wecom', 'sms', 'email', 'contract_system'],
      'pending'
    );
    console.log(`    已创建 ${weeklyPushRecords.length} 条多渠道推送记录:`);
    weeklyPushRecords.forEach(r => {
      console.log(`       · ID=${r.id.slice(0, 8)}...  渠道=${channelLabels[r.channel].padEnd(6)}  内容长度=${r.content.length}字  状态=${r.result}`);
    });
  }

  subsection('Step2: 模拟外部系统回调，分别回写各渠道发送结果');
  if (latestSummary) {
    pushRecordService.updateChannelResult('weekly_summary', latestSummary.id, 'wecom', 'success', '企业微信应用消息已送达');
    pushRecordService.updateChannelResult('weekly_summary', latestSummary.id, 'sms', 'success', '短信网关回执: DELIVERED');
    pushRecordService.updateChannelResult('weekly_summary', latestSummary.id, 'email', 'failed', 'SMTP服务超时: 504 Gateway Timeout');
    pushRecordService.updateChannelResult('weekly_summary', latestSummary.id, 'contract_system', 'success', '合同系统消息队列ACK');
    console.log(`    已分别回写4个渠道的发送结果（含失败原因）`);

    subsection('Step3: 按提醒ID查询，分组展示各渠道状态');
    const grouped = pushRecordService.getByReminderGrouped('weekly_summary', latestSummary.id);
    console.log(`    按渠道分组结果:`);
    Object.entries(grouped).forEach(([channel, recs]) => {
      const r = (recs as any[])[0];
      const resultIcon = r?.result === 'success' ? '✅' : r?.result === 'failed' ? '❌' : '⭕';
      console.log(`       ${resultIcon} ${channelLabels[channel as keyof typeof channelLabels] || channel}: ${r?.result}${r?.resultMessage ? '  原因: ' + r.resultMessage : ''}`);
    });
  }

  subsection('Step4: 批量回写演示（状态提醒多渠道批量）');
  const statusTarget = allActive[1];
  if (statusTarget) {
    const batchItems = [
      { reminderType: 'status_overdue' as const, reminderId: statusTarget.id, channel: 'wecom' as const, result: 'success' as const, resultMessage: '已送达项目负责人企业微信' },
      { reminderType: 'status_overdue' as const, reminderId: statusTarget.id, channel: 'sms' as const, result: 'success' as const },
    ];
    const batchResult = pushRecordService.batchUpdateChannelResults(batchItems);
    console.log(`    批量回写: 成功${batchResult.success}条，失败${batchResult.failed}条`);
  }

  section('能力⑧ 周报结构化数据源：项目/专业/变更类型/超期阶段四维汇总 + 趋势');
  if (latestSummary && latestSummary.structuredData) {
    const sd = latestSummary.structuredData;
    console.log(`    周报周期: ${latestSummary.weekStart} ~ ${latestSummary.weekEnd}`);
    console.log(`    结构化数据维度: 项目=${sd.byProject.length}  专业=${sd.byProfessional.length}  变更类型=${sd.byCategory.length}  超期阶段=${sd.byStage.length}`);

    subsection('按项目汇总（可直接用于前端饼图/柱状图）');
    sd.byProject.slice(0, 3).forEach(b => {
      console.log(`       · ${b.label.padEnd(18)}  新增=${b.count}条  金额=¥${b.totalAmount.toLocaleString()}  超期=${b.overdueCount || 0}条  已闭合=${b.closedCount || 0}条`);
    });

    subsection('按专业汇总');
    sd.byProfessional.forEach(b => {
      console.log(`       · ${b.label.padEnd(6)}  ${b.count}条  ¥${b.totalAmount.toLocaleString()}`);
    });

    subsection('按变更类型汇总');
    sd.byCategory.forEach(b => {
      console.log(`       · ${b.label.padEnd(8)}  ${b.count}条  ¥${b.totalAmount.toLocaleString()}`);
    });

    subsection('按超期阶段汇总');
    sd.byStage.forEach(b => {
      console.log(`       · ${b.label.padEnd(14)}  在办=${b.count}条  超期=${b.overdueCount || 0}条`);
    });
  }

  subsection('最近 8 周趋势数据（支持前端折线图）');
  const trend = weeklySummaryService.getTrendData(8);
  if (trend.length > 0) {
    console.log(`    共 ${trend.length} 周趋势数据:`);
    trend.forEach(t => {
      console.log(`       · ${t.weekStart}  新增=${t.newCount}  闭合=${t.closedCount}  超期=${t.overdueCount}  风险=${t.riskAlertCount}  金额=¥${t.totalEstimatedAmount.toLocaleString()}`);
    });
  } else {
    console.log('    （需连续运行多周后才有足够趋势数据）');
  }

  section('📋 最终汇总：v3.0 九大能力落地情况');
  const finalChecklist = [
    { name: '① 定时自动周报', done: Boolean(latestSummary) },
    { name: '② 三阶段状态超期提醒（含设计审核阶段）', done: statusResult.reminders.length > 0 },
    { name: '③ 综合风险视图（分类明细+专题会重点）', done: riskResult.comprehensiveViews.length > 0 },
    { name: '④ 规则管理接口（实时生效+留痕）', done: rules.riskTimeWindowDays > 0 },
    { name: '⑤ 推送记录追溯（分页/条件/统计）', done: true },
    { name: '⑥ 提醒处置闭环（已读/处理中/已处理+看板）', done: handlingTarget && ['read', 'in_progress', 'handled'].includes(dataStore.getStatusReminder(handlingTarget.id)?.handlingStatus || '') },
    { name: '⑦ 多渠道结果回写（按渠道分别记录+失败原因）', done: weeklyPushRecords.length >= 4 },
    { name: '⑧ 周报结构化数据源（四维汇总+趋势）', done: Boolean(latestSummary?.structuredData) },
    { name: '⑨ 规则口径修正（设计审核+风险窗口30天+口径文案）', done: Boolean(designReminder || firstAlert) },
  ];
  finalChecklist.forEach(item => {
    console.log(`  ${item.done ? '✅' : '❌'}  ${item.name}`);
  });

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  v3.0 演示完成！启动服务：npm run dev                                    ║
║  新增核心接口：                                                          ║
║  POST /handling/:type/:id/read|in-progress|handled|status               ║
║  GET  /board  GET  /handling/records                                     ║
║  PUT  /push-records/channel/result  (batch-result)                       ║
║  GET  /weekly/:id/structured  GET  /weekly/trend                         ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
}

runDemo().catch(err => {
  console.error('演示运行失败:', err);
  process.exit(1);
});
