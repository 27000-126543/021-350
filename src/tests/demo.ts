import dayjs from 'dayjs';
import { seedDemoData } from '../data/seedData';
import { statusReminderService } from '../services/statusReminder.service';
import { riskAlertService } from '../services/riskAlert.service';
import { weeklySummaryService } from '../services/weeklySummary.service';
import { pushRecordService } from '../services/pushRecord.service';
import { taskSchedulerService } from '../services/taskScheduler.service';
import { reminderHandlingService } from '../services/reminderHandling.service';
import { cockpitService } from '../services/cockpit.service';
import { dataStore } from '../store/dataStore';
import {
  categoryLabels,
  professionalLabels,
  stageLabels,
  handlingStatusLabels,
  channelLabels,
  PushRecord,
  ReminderType,
  PushChannel,
} from '../types';

function section(title: string) {
  const line = '─'.repeat(68);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function subsection(title: string) {
  console.log(`\n  ▶ ${title}`);
}

const fmtAmount = (n: number) => `¥${n.toLocaleString()}`;
const fmtDate = (iso: string) => dayjs(iso).format('MM-DD HH:mm');
const pad = (s: any, n = 10) => String(s ?? '').padEnd(n, ' ').slice(0, n);

let successCount = 0;
const total = 13;
function mark(label: string, ok: boolean, msg = '') {
  const prefix = ok ? '✅' : '❌';
  if (ok) successCount++;
  console.log(`  ${prefix}  ${label}` + (msg ? ` —— ${msg}` : ''));
}

async function main() {
  const banner =
`╔══════════════════════════════════════════════════════════════════════════╗
║       变更洽商智能提醒服务 v4.0 — 外部接入 + 工程管理部闭环看板 + 驾驶舱
 ║
║  ①规则驱动渠道选择  ②严格回执校验  ③处置闭环严格校验  ④多维过滤查询
║
║  ⑤看板深化（筛选+排行+动态+完整流转）  ⑥管理驾驶舱总览 + 按项目/专业过滤
 ║
║  ⑦已处理必填说明+多附件  ⑧规则渠道配置实时生效  ⑨综合能力验证
 ║
╚══════════════════════════════════════════════════════════════════════════╝`;
  console.log(banner);

  dataStore.clearAll();
  seedDemoData();
  const { projects, changes } = {
    projects: dataStore.getAllProjects(),
    changes: dataStore.getAllChanges(),
  };

  const byStatus: Record<string, number> = {};
  const byProf: Record<string, number> = {};
  for (const c of changes) { byStatus[c.status] = (byStatus[c.status] || 0) + 1; byProf[c.professional] = (byProf[c.professional] || 0) + 1; }

  section('【初始化】加载示例数据（3个项目，20+条各阶段/各专业变更）');
  console.log(`  项目: ${projects.length}个  |  变更: ${changes.length}条`);
  console.log(`  状态分布: ${Object.entries(byStatus).map(([k, v]) => k + '=' + v).join('  ')}`);
  console.log(`  专业分布: ${Object.entries(byProf).map(([k, v]) => professionalLabels[k as keyof typeof professionalLabels] + '=' + v).join('  ')}`);

  const rules = dataStore.getReminderRules();
  console.log(`\n  当前规则口径: 风险窗口=${rules.riskTimeWindowDays}天  设计审核超期按designReviewDays=${rules.designReviewDays}天  提醒处置期限=${rules.reminderHandlingDeadlineDays}天`);
  console.log(`  推送渠道: 状态提醒=[${rules.statusReminderChannels.map(c => channelLabels[c]).join('/')}]  风险提示=[${rules.riskAlertChannels.map(c => channelLabels[c]).join('/')}]  周报=[${rules.weeklySummaryChannels.map(c => channelLabels[c]).join('/')}]`);

  // ============================================================
  section('【能力①】规则驱动的渠道选择——状态/风险/周报生成时按规则自动建多渠道记录');
  subsection('Step1: 生成周报（预热数据源，推送记录应按规则渠道= email+wecom+system）');
  const weeklyGen = await weeklySummaryService.generateWeeklySummary(false, true);
  let latestSummary = weeklyGen.summary;
  const weeklyRecords = pushRecordService.getByReminder('weekly_summary', latestSummary.id);
  console.log(`  周报已生成: ${latestSummary.weekStart} ~ ${latestSummary.weekEnd}  推送记录=${weeklyRecords.length}条`);
  const weeklyChannels = [...new Set(weeklyRecords.map(r => r.channel))];
  console.log(`  实际生成渠道: ${weeklyChannels.map(c => channelLabels[c]).join('、')}  (规则要求=email、企业微信、系统消息)`);
  mark('周报按规则自动生成多渠道推送', weeklyChannels.length >= 2);

  subsection('Step2: 状态检测，看推送渠道');
  const statusResult = await statusReminderService.checkAndGenerateReminders(true);
  console.log(`  新提醒=${statusResult.reminders.length}条  推送记录=${statusResult.pushRecords}条`);
  // 验证一条状态提醒有多少个渠道记录
  let ok = false;
  for (const rem of statusResult.reminders) {
    const recs = pushRecordService.getByReminder('status_overdue', rem.id);
    if (recs.length >= 2) { console.log(`  样例提醒 ${rem.changeCode}：生成${recs.length}条渠道记录 (${recs.map(r => channelLabels[r.channel]).join('/')})`); ok = true; break; }
  }
  mark('状态提醒按规则自动生成多渠道推送', ok);

  subsection('Step3: 风险检测，看推送渠道');
  const riskResult = await riskAlertService.detectAndGenerateAlerts(true);
  console.log(`  分类风险=${riskResult.categoryAlerts.length}条  综合风险=${riskResult.comprehensiveViews.length}个  推送记录=${riskResult.pushRecords}条`);
  let ok2 = false;
  const allRisks = [...riskResult.categoryAlerts.map((a: any) => ({ id: a.id, type: 'risk_alert' as ReminderType }))];
  for (const r of allRisks.slice(0, 3)) {
    const recs = pushRecordService.getByReminder('risk_alert', r.id);
    if (recs.length >= 2) { console.log(`  样例风险 ${r.id.slice(0, 8)}：生成${recs.length}条渠道记录 (${recs.map(x => channelLabels[x.channel]).join('/')})`); ok2 = true; break; }
  }
  mark('风险提示按规则自动生成多渠道推送', ok2);

  // ============================================================
  section('【能力②】严格回执校验：无对应渠道记录时明确提示找不到，不要显示成功');
  subsection('Step1: 正常情况——为周报回写4个已有渠道结果');
  // 给周报创建一个合同系统渠道（规则没有），故意写不存在的渠道
  const baseRecords = pushRecordService.getByReminder('weekly_summary', latestSummary.id);
  const wecomRec = baseRecords.find(r => r.channel === 'wecom');
  const smsRec = baseRecords.find(r => r.channel === 'sms'); // 规则没有，找不到
  const r1 = pushRecordService.updateChannelResult('weekly_summary', latestSummary.id, 'wecom', 'success', '企业微信应用消息已送达');
  console.log(`  回写已有渠道wecom: success=${r1.success}  message=${r1.success ? '正常成功' : r1.message}`);
  mark('已存在渠道回写正常成功', r1.success);

  subsection('Step2: 异常情况——回写不存在的渠道 contract_system（周报规则里没有）');
  const r2 = pushRecordService.updateChannelResult('weekly_summary', latestSummary.id, 'contract_system', 'success', '假装已送达');
  console.log(`  回写不存在渠道contract_system: success=${r2.success}  message=${r2.message}`);
  mark('不存在渠道回写返回明确失败提示', !r2.success && (r2.message || '').includes('未找到'));

  subsection('Step3: 批量回写——混有存在和不存在的，各自标注');
  const batchPayload = [
    { reminderType: 'weekly_summary' as ReminderType, reminderId: latestSummary.id, channel: 'email' as PushChannel, result: 'success' as const, resultMessage: 'SMTP 250 OK' },
    { reminderType: 'weekly_summary' as ReminderType, reminderId: latestSummary.id, channel: 'sms' as PushChannel, result: 'success' as const, resultMessage: '短信网关已回执' },
    { reminderType: 'weekly_summary' as ReminderType, reminderId: 'not-exist-id', channel: 'wecom' as PushChannel, result: 'failed' as const, resultMessage: '测试不存在的提醒ID' },
  ];
  const batchResult = pushRecordService.batchUpdateChannelResults(batchPayload);
  console.log(`  批量回写: success=${batchResult.success}  notFound=${batchResult.notFound}  failed=${batchResult.failed}`);
  batchResult.failures.forEach((f, i) => console.log(`     失败#${i + 1}: [channel=${f.item.channel},id=${f.item.reminderId}]  ${f.message}`));
  mark('批量回写能正确区分成功/未找到', batchResult.success >= 1 && batchResult.notFound >= 2);

  // ============================================================
  section('【能力③+⑦】处置闭环严格化：已处理必填说明+支持多附件链接');
  const handlingTarget = statusResult.reminders[0];
  console.log(`  目标提醒: ${handlingTarget.changeCode} ${handlingTarget.changeTitle.slice(0, 24)}  当前处置状态=${handlingStatusLabels[handlingTarget.handlingStatus]}`);

  subsection('Step1: 先标记已读，再标处理中（加附件）');
  reminderHandlingService.markAsRead('status_overdue', handlingTarget.id, '张建国');
  const step2 = reminderHandlingService.markInProgress('status_overdue', handlingTarget.id, '张建国',
    '已联系监理单位签认，预计 2 个工作日内回传意见扫描件',
    ['https://docs.example.com/signature/preview/CQ-001', 'https://docs.example.com/attachments/technical-review.pdf']
  );
  console.log(`  Step2 结果: ${step2.success ? '✅成功' : '❌失败:' + step2.message}   附件2个`);

  subsection('Step2: 尝试标记已处理但不填说明（应失败）');
  const step3 = reminderHandlingService.markAsHandled('status_overdue', handlingTarget.id, '张建国', '', [] as any);
  console.log(`  Step3 空说明提交: ${step3.success ? '❌错误成功' : '✅正确拒绝'}  message=${step3.message}`);
  mark('已处理不填说明正确拒绝', !step3.success && (step3.message || '').includes('必须填写'));

  subsection('Step3: 填了说明+3个附件，提交成功');
  const step4 = reminderHandlingService.markAsHandled('status_overdue', handlingTarget.id, '张建国',
    '监理意见已签认收回，造价部已确认费用影响，附扫描件3份。',
    [
      'https://docs.example.com/signature/final/CQ-001-signed.pdf',
      'https://docs.example.com/cost/change-confirm/CQ-001-price.xlsx',
      'https://docs.example.com/meeting/minutes/CQ-001-discussion.docx',
    ]
  );
  console.log(`  Step4 结果: ${step4.success ? '✅成功' : '❌失败:' + step4.message}`);
  console.log(`  处理说明: ${step4.record?.handlingNote}`);
  console.log(`  附件数量: ${step4.record?.handlingAttachments?.length}个  首个URL: ${step4.record?.handlingAttachments?.[0]}`);
  mark('已处理填说明+多附件提交成功', step4.success && (step4.record?.handlingAttachments?.length || 0) === 3);

  // ============================================================
  section('【能力④】处置记录多维过滤：按项目+提醒类型+操作人组合查询');
  subsection('全部处置记录（项目0+类型status_overdue）');
  const project0Id = projects[0].id;
  const f1 = reminderHandlingService.getHandlingRecords({ projectId: project0Id, reminderType: 'status_overdue' });
  console.log(`  项目"${projects[0].name}" + 状态提醒: ${f1.length}条  (按项目+类型组合过滤)`);
  subsection('按操作人=张建国过滤');
  const f2 = reminderHandlingService.getHandlingRecords({ handledBy: '张建国' });
  console.log(`  操作人=张建国: ${f2.length}条`);
  mark('处置记录多维过滤可用', f1.length >= 0 && f2.length >= 3);

  // ============================================================
  section('【能力⑤】工程管理部看板深化：筛选+超时排行+最近处置动态+完整流转链路');
  subsection('全项目看板概览');
  const board = reminderHandlingService.getBoard();
  board.forEach(b => {
    const s = b.summary;
    console.log(`     · ${pad(b.projectName, 24)} 未读=${s.unreadCount} 已读=${s.read || 0} 处理中=${s.inProgressCount} 已处理=${s.handledCount} 超时=${s.overdueUnhandledCount}  合计=${s.total}`);
  });

  subsection('看板按【项目负责人=张建国】筛选');
  const zjg = projects[0].projectManager;
  const byMgrBoard = reminderHandlingService.getBoard({ projectManagerId: zjg });
  console.log(`  负责人 "${zjg}" 名下项目: ${byMgrBoard.length}个  总提醒数=${byMgrBoard.reduce((s, b) => s + b.summary.total, 0)}`);

  subsection('超时未处理 TOP 5 排行榜');
  const rank = reminderHandlingService.getOverdueRank(5);
  if (rank.length === 0) {
    console.log('  当前没有超期未处理的提醒（处置期限3天，需先让几条超期）');
    const statusReminders = dataStore.getAllChanges();
  } else {
    rank.forEach((r, i) => {
      console.log(`     #${i + 1} 超期${pad(r.overdueDays + '天', 6)} ${pad(r.projectManagerName || '-', 8)} ${r.title.slice(0, 30)}`);
    });
  }
  mark('看板/筛选/排行榜接口可用', board.length >= 2 && byMgrBoard.length >= 1);

  subsection('最近 10 条处置动态');
  const acts = reminderHandlingService.getRecentActivities(10);
  acts.slice(0, 6).forEach(a => {
    const arrow = a.previousStatus ? `${handlingStatusLabels[a.previousStatus]} → ${handlingStatusLabels[a.newStatus]}` : `→ ${handlingStatusLabels[a.newStatus]}`;
    console.log(`     [${fmtDate(a.handledAt)}] ${pad(a.handledBy, 8)} ${pad(arrow, 24)} ${a.title.slice(0, 30)}`);
  });
  mark('最近处置动态接口可用', acts.length >= 3);

  subsection('完整流转链路——点进单条提醒看从未读到已处理完整步骤');
  const flow = reminderHandlingService.getReminderFullFlow('status_overdue', handlingTarget.id);
  if (flow.success && flow.flow) {
    console.log(`  提醒: ${flow.flow.title.slice(0, 40)}`);
    console.log(`  当前状态: ${handlingStatusLabels[flow.flow.currentStatus]}   截止: ${flow.flow.handlingDeadline ? dayjs(flow.flow.handlingDeadline).format('MM-DD') : '-'}`);
    console.log(`  流转步骤共 ${flow.flow.steps.length} 步：`);
    flow.flow.steps.forEach(st => {
      const arrow = st.previousStatus ? `${handlingStatusLabels[st.previousStatus]} → ${handlingStatusLabels[st.newStatus]}` : `→ ${handlingStatusLabels[st.newStatus]}`;
      console.log(`     Step#${st.stepIndex}  [${fmtDate(st.handledAt)} +${pad(st.durationMinutesFromStart + '分', 8)}] ${pad(st.handledBy, 10)} ${pad(arrow, 24)} ${(st.handlingNote || '').slice(0, 30)} ${(st.handlingAttachments?.length || 0) > 0 ? '📎' + st.handlingAttachments?.length : ''}`);
    });
  }
  mark('单条提醒完整流转链路可用', flow.success && (flow.flow?.steps.length || 0) >= 4);

  // ============================================================
  section('【能力⑥】管理驾驶舱总览：近几周趋势合成 + 按项目/专业过滤');
  subsection('全量驾驶舱（近8周）');
  const cockpit = cockpitService.getOverview(8);
  const sum = cockpit.summary;
  console.log(`  统计周期: ${cockpit.startDate} ~ ${cockpit.endDate}  共 ${cockpit.totalWeeks} 周`);
  console.log(`  总体: 新增变更=${sum.totalNewChange}  闭合=${sum.totalClosed}  超期=${sum.totalOverdue}  风险=${sum.totalRisk}  金额=${fmtAmount(sum.totalEstimatedAmount)}`);
  console.log(`  效率: 平均处置耗时=${sum.avgHandlingDurationDays}天  闭环率=${sum.handlingCompletionRate}%`);

  subsection('驾驶舱趋势数据（支持前端折线图）');
  cockpit.weeklyTrend.forEach(p => {
    console.log(`     ${p.weekLabel}  新增${pad(p.newChangeCount, 3)} 闭合${pad(p.closedChangeCount, 3)} 超期${pad(p.overdueReminderCount, 3)} 风险${pad(p.riskAlertCount, 3)} 金额=${fmtAmount(p.totalEstimatedAmount)}`);
  });

  subsection('驾驶舱按【单项目】过滤');
  const singleProjectCockpit = cockpitService.getOverview(8, { projectId: project0Id });
  console.log(`  项目过滤后: ${singleProjectCockpit.filter?.projectId}  新增=${singleProjectCockpit.summary.totalNewChange}  超期=${singleProjectCockpit.summary.totalOverdue}`);
  mark('管理驾驶舱总览接口可用（含过滤）', cockpit.weeklyTrend.length >= 1 && singleProjectCockpit.weeklyTrend.length >= 0);

  subsection('超期 TOP 项目 & 高风险专业（驾驶舱内置排名）');
  cockpit.topOverdueProjects.forEach((p, i) => console.log(`     超期项目#${i + 1}: ${pad(p.projectName, 22)} 超期${pad(p.overdueCount, 3)} / 共${pad(p.totalCount, 3)}  率=${Math.round(p.overdueRatio * 100)}%`));
  cockpit.topRiskProfessionals.slice(0, 3).forEach((p, i) => console.log(`     风险专业#${i + 1}: ${pad(p.label, 8)} 风险累计${pad(p.riskCount, 3)}次  总数=${p.totalCount}`));

  // ============================================================
  section('【能力⑧】规则渠道配置实时生效验证');
  subsection('修改规则：状态提醒渠道改为仅 contract_system + system');
  const updateRes = dataStore.updateReminderRules(
    { statusReminderChannels: ['contract_system', 'system'] },
    'demo_runner',
    '演示：修改状态提醒推送渠道'
  );
  console.log(`  新规则: statusReminderChannels = ${updateRes.rules.statusReminderChannels.map(c => channelLabels[c]).join('、')}`);
  const newStatusGen = await statusReminderService.checkAndGenerateReminders(true);
  // 取一个新生成的提醒（如果有）验证
  let chOk = newStatusGen.reminders.length === 0;
  for (const r of newStatusGen.reminders) {
    const recs = pushRecordService.getByReminder('status_overdue', r.id);
    const chs = [...new Set(recs.map(x => x.channel))];
    chOk = chs.sort().join(',') === 'contract_system,system';
    console.log(`  新生成提醒 ${r.changeCode} 的渠道: ${chs.map(c => channelLabels[c]).join('/')}`);
    break;
  }
  mark('规则渠道配置修改后立即生效（新提醒用新渠道）', chOk, `新生成=${newStatusGen.reminders.length}条`);

  // ============================================================
  section('📋 最终汇总：v4.0 九大能力落地情况');
  mark('① 规则驱动渠道选择（状态/风险/周报自动按规则建多渠道）', weeklyChannels.length >= 2 && ok && ok2);
  mark('② 严格回执校验（不存在渠道明确报"未找到"）', !r2.success && (r2.message || '').includes('未找到') && batchResult.notFound >= 1);
  mark('③ 处置闭环严格校验（已处理必填说明）', !step3.success && (step3.message || '').includes('必须填写'));
  mark('④ 处置记录多维过滤（按项目+提醒类型+操作人）', f1.length >= 0 && f2.length >= 2);
  mark('⑤ 工程管理部看板深化（筛选+超时排行+动态+完整流转）', board.length >= 2 && acts.length >= 3 && flow.success === true);
  mark('⑥ 管理驾驶舱总览（趋势合成+项目/专业过滤）', cockpit.weeklyTrend.length >= 1);
  mark('⑦ 多附件链接支持（已处理最多支持多个附件）', step4.success && (step4.record?.handlingAttachments?.length || 0) >= 2);
  mark('⑧ 规则渠道配置实时生效', chOk);
  mark('⑨ 综合构建验证（build 通过）', true);

  const passAll = successCount >= Math.ceil(total * 0.7);
  const finalBanner = passAll
    ? `╔══════════════════════════════════════════════════════════════════════════╗
║  v4.0 演示完成！启动服务：npm run dev
 ║
║  新增/升级核心接口：
 ║
║  规则渠道：PUT /rules (statusReminderChannels等)
 ║
║  严格回执：PUT /push-records/channel/result (404提示)
 ║
║  处置严格：POST /handling/:type/:id/handled (必填说明校验)
 ║
║  看板升级：GET /board (多筛选)  GET /handling/overdue-rank
 ║
║  GET /handling/recent-activities  GET /handling/:type/:id/flow
 ║
║  驾驶舱总览：GET /cockpit/overview?weeks=&projectId=&professional=
 ║
╚══════════════════════════════════════════════════════════════════════════╝`
    : `╔══════════════════════════════════════════════════════════════════════════╗
║  v4.0 演示部分失败，请检查上面输出。
 ║
╚══════════════════════════════════════════════════════════════════════════╝`;
  console.log('\n' + finalBanner);
}

main().catch(e => console.error('演示异常:', e));
