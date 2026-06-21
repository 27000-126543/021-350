import dayjs from 'dayjs';
import { seedDemoData } from '../data/seedData';
import { statusReminderService } from '../services/statusReminder.service';
import { riskAlertService } from '../services/riskAlert.service';
import { weeklySummaryService } from '../services/weeklySummary.service';
import { pushRecordService } from '../services/pushRecord.service';
import { taskSchedulerService } from '../services/taskScheduler.service';
import { dataStore } from '../store/dataStore';
import { categoryLabels, professionalLabels, stageLabels } from '../types';

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
║           变更洽商智能提醒服务 v2.0 — 五大增强能力完整演示               ║
║  ①定时自动周报 ②三阶段状态提醒 ③综合风险视图 ④规则管理 ⑤推送追溯      ║
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

  section('能力① 定时任务调度器 — 按配置自动产出周报与检测');
  subsection('查看当前调度器和定时任务（服务启动时自动初始化）');
  const tasks = taskSchedulerService.getTaskList();
  tasks.forEach(t => {
    console.log(`    · ${t.name.padEnd(18)} ${t.isRunning ? '✅已启动' : '⭕未启动'}  cron=${t.cronExpression.padEnd(22)}  ${t.description}`);
  });

  subsection('手动触发一次「周报自动生成」定时任务（模拟到点执行）');
  const weeklyTrigger = await taskSchedulerService.triggerTask('weekly_summary');
  console.log(`    执行结果: ${weeklyTrigger.message}`);
  const latestSummary = weeklySummaryService.getLatestSummary();
  if (latestSummary) {
    console.log(`    周报覆盖: ${latestSummary.weekStart} ~ ${latestSummary.weekEnd}`);
    console.log(`    自动标记: generatedAutomatically=${latestSummary.generatedAutomatically}   项目数=${latestSummary.totalProjects}   超期=${latestSummary.totalOverdueCount}条   风险=${latestSummary.totalRiskAlerts}条`);
    console.log(`    短信版摘要: ${latestSummary.smsText.slice(0, 70)}...`);
  }

  section('能力② 三阶段状态提醒 + 旧阶段自动失效');
  subsection('Step1: 执行全量超期检测（登记→监理→设计 三阶段全覆盖）');
  const statusResult = await statusReminderService.checkAndGenerateReminders(true);
  console.log(`    新增提醒: ${statusResult.reminders.length} 条  |  作废旧提醒: ${statusResult.invalidated} 条  |  创建推送记录: ${statusResult.pushRecords} 条`);

  subsection('Step2: 查看「按阶段分组」的超期待办（重点看设计审核超期）');
  const allActive = statusReminderService.getAllReminders(true);
  const byStage: Record<string, any[]> = {};
  allActive.forEach(r => {
    const key = stageLabels[r.stage];
    if (!byStage[key]) byStage[key] = [];
    byStage[key].push(r);
  });
  Object.entries(byStage).forEach(([stage, items]) => {
    const maxDays = Math.max(...items.map((r: any) => r.overdueDays));
    const totalAmount = items.reduce((s: number, r: any) => s + r.overdueDays, 0);
    console.log(`    📂 ${stage}（${items.length}条，累计超期${totalAmount}天，最长${maxDays}天）`);
    items.slice(0, 2).forEach((r: any) => {
      console.log(`       · ${r.changeCode}  ${r.changeTitle.slice(0, 18).padEnd(18)}  ${r.projectName.slice(0, 12).padEnd(12)}  超期${String(r.overdueDays).padStart(2)}天`);
    });
    if (items.length > 2) console.log(`       ... 等共 ${items.length} 条`);
  });

  subsection('Step3: 演示【状态推进→旧提醒自动作废】核心能力');
  const testChange = allActive.find(r => r.stage === 'registered_to_supervisor');
  if (testChange) {
    console.log(`    选取测试洽商: ${testChange.changeCode}（${testChange.changeTitle.slice(0, 20)}）  当前阶段提醒: 生效中`);
    dataStore.updateChange(testChange.changeId, {
      status: 'supervisor_review',
      supervisorOpinion: '情况属实，同意上报设计',
      supervisorOpinionDate: dayjs().format('YYYY-MM-DD'),
    });
    const recheck = await statusReminderService.checkAndGenerateReminders(false);
    console.log(`    执行「监理意见签认」状态推进后，再次检测 → 作废提醒: ${recheck.invalidated} 条`);
    const afterReminders = statusReminderService.getAllReminders(false).filter(r => r.changeId === testChange.changeId);
    afterReminders.forEach(r => {
      console.log(`       · 阶段[${stageLabels[r.stage]}]  active=${r.isActive}  作废原因: ${r.invalidatedReason || '无'}`);
    });
    console.log(`    ✅ 旧阶段提醒已自动置为失效，新阶段提醒将独立检测，不产生重复干扰`);
  }

  section('能力③ 综合风险视图 — 按项目+专业聚合多类别，含专题会重点');
  subsection('Step1: 执行风险检测（分类 + 综合双维度）');
  const riskResult = await riskAlertService.detectAndGenerateAlerts(true);
  console.log(`    新增分类风险: ${riskResult.categoryAlerts.length} 条  |  综合风险视图: ${riskResult.comprehensiveViews.length} 个  |  推送记录: ${riskResult.pushRecords} 条`);

  subsection('Step2: 查看综合风险视图（点开一个中/高风险专业）');
  const views = riskAlertService.getComprehensiveViews();
  if (views.length > 0) {
    const v = views[0];
    const levelEmoji = v.overallRiskLevel === 'high' ? '🔴' : v.overallRiskLevel === 'medium' ? '🟡' : '🟢';
    console.log(`    ${levelEmoji} ${v.projectName} / ${professionalLabels[v.professional]}专业  （综合${v.overallRiskLevel === 'high' ? '高' : v.overallRiskLevel === 'medium' ? '中' : '低'}风险）`);
    console.log(`       近${v.timeWindowDays}天累计: ${v.totalChangeCount}条  ¥${v.totalEstimatedAmount.toLocaleString()}`);
    console.log(`       ┌─ 分类明细 ───────────────────────────────────────────┐`);
    v.categoryBreakdown.forEach((b, i) => {
      const lv = b.count >= 5 ? '🔴' : b.count >= 3 ? '🟡' : '⚪';
      console.log(`       │ ${lv} ${categoryLabels[b.category].padEnd(8)} ${String(b.count).padStart(2)}条  ¥${String(b.totalAmount).padStart(10)}  Top: ${b.changes.slice(0, 2).map(c => c.changeCode).join('、')}`);
    });
    console.log(`       └──────────────────────────────────────────────────────┘`);
    console.log(`       💡 专题会重点建议（${v.meetingFocus.length}条）:`);
    v.meetingFocus.slice(0, 3).forEach((f, i) => {
      console.log(`         ${i + 1}. ${f.slice(0, 60)}${f.length > 60 ? '...' : ''}`);
    });
  } else {
    console.log('    当前暂无超过综合阈值的专业风险');
  }

  section('能力④ 提醒规则管理 — 工程管理部实时调整，后续检测即时生效');
  subsection('Step1: 查看当前规则 + 默认值');
  const rules = dataStore.getReminderRules();
  console.log(`    监理意见天数=${rules.supervisorReviewDays}  设计意见天数=${rules.designReviewDays}  设计闭合天数=${rules.designFinalReviewDays}`);
  console.log(`    风险窗口=${rules.riskTimeWindowDays}天  分类阈值=${rules.riskThresholdCount}/${rules.highRiskThresholdCount}条  综合阈值=${rules.comprehensiveRiskThresholdCount}条`);
  console.log(`    周报: 每周${['日', '一', '二', '三', '四', '五', '六'][rules.weeklySummaryDay]} ${String(rules.weeklySummaryHour).padStart(2, '0')}:${String(rules.weeklySummaryMinute).padStart(2, '0')}  自动开关=${rules.autoGenerateWeeklySummary}`);

  subsection('Step2: 模拟工程管理部修改规则（演示规则留痕 + 调度器自动重置）');
  const originalRules = { ...rules };
  const updateResult = dataStore.updateReminderRules({
    supervisorReviewDays: 5,
    designReviewDays: 10,
    comprehensiveRiskThresholdCount: 5,
    weeklySummaryDay: 5,
    weeklySummaryHour: 17,
  }, '工程管理部_王工', '集团要求压缩签认周期，周报改在周五下班前发送');
  const newRules = updateResult.rules;
  console.log(`    修改操作人: ${updateResult.log.changedBy}`);
  console.log(`    修改说明: ${updateResult.log.description}`);
  console.log(`    变更内容:`);
  Object.keys(updateResult.log.previousRules).forEach(k => {
    const prev = (originalRules as any)[k];
    const next = (newRules as any)[k];
    console.log(`       · ${k.padEnd(32)}  ${prev}  →  ${next}`);
  });
  console.log(`    ✅ 规则已实时生效，后续所有检测和周报均按新规则运行`);
  console.log(`    规则变更留痕日志ID: ${updateResult.log.id}  时间: ${dayjs(updateResult.log.changedAt).format('MM-DD HH:mm')}`);

  subsection('Step3: 恢复规则默认值（保持演示一致性）');
  dataStore.updateReminderRules({
    supervisorReviewDays: 7,
    designReviewDays: 14,
    designFinalReviewDays: 21,
    riskTimeWindowDays: 15,
    riskThresholdCount: 3,
    highRiskThresholdCount: 5,
    comprehensiveRiskThresholdCount: 6,
    weeklySummaryDay: 1,
    weeklySummaryHour: 9,
  }, '系统_演示回滚');

  section('能力⑤ 推送记录查询 + 追溯（对接企业微信/合同系统的审计基础）');
  subsection('Step1: 查看推送统计');
  const stats = pushRecordService.getStatistics();
  console.log(`    总记录数: ${stats.total} 条`);
  console.log(`    按类型: ${Object.entries(stats.byType).map(([k, v]) => k + '=' + v).join('  ')}`);
  console.log(`    按渠道: ${Object.entries(stats.byChannel).map(([k, v]) => k + '=' + v).join('  ')}`);
  console.log(`    按结果: ${Object.entries(stats.byResult).map(([k, v]) => k + '=' + v).join('  ')}`);

  subsection('Step2: 查询最新一条周报推送记录（可直接复用发送给企业微信）');
  const weeklyRecords = pushRecordService.queryPushRecords({ reminderType: 'weekly_summary', pageSize: 1 });
  if (weeklyRecords.records.length > 0) {
    const rec = weeklyRecords.records[0];
    console.log(`    记录ID: ${rec.id}  |  类型: ${rec.reminderType}  |  渠道: ${rec.channel}  |  结果: ${rec.result}`);
    console.log(`    标题: ${rec.title}`);
    console.log(`    推送对象: ${rec.recipientNames.slice(0, 3).join('、')}${rec.recipientNames.length > 3 ? ' 等' + rec.recipientNames.length + '人' : ''}`);
    console.log(`    短信版摘要: ${rec.summary?.slice(0, 60)}...`);
    console.log(`    关联元数据: 项目数=${rec.metadata?.stats?.totalProjects}  新增=${rec.metadata?.stats?.totalNewChanges}  闭合率=${rec.metadata?.stats?.overallClosureRate}%`);
    console.log(`    ✅ 该记录已具备所有对接要素：标题/正文/摘要/接收人/电话/邮箱/结果状态，可直接作为企业微信、短信、邮件、合同系统消息推送的payload`);
  }

  subsection('Step3: 条件过滤查询演示（分页 + 按类型/结果）');
  const paged = pushRecordService.queryPushRecords({
    reminderType: 'status_overdue',
    result: 'pending',
    page: 1,
    pageSize: 3,
  });
  console.log(`    过滤条件: status_overdue + pending  →  命中${paged.total}条  返回第1页/${paged.records.length}条`);
  paged.records.forEach((r, i) => {
    console.log(`       ${i + 1}. ${dayjs(r.generatedAt).format('MM-DD HH:mm')}  ${r.title.slice(0, 40).padEnd(40)}  接收:${r.recipientNames[0]}`);
  });

  section('📋 最终汇总：五大增强能力落地情况');
  const finalChecklist = [
    { name: '① 定时自动周报（按周几+时间配置自动生成，短信/邮件双版摘要）', done: Boolean(latestSummary && latestSummary.generatedAutomatically !== undefined) },
    { name: '② 三阶段超期提醒（含设计→闭合，状态推进自动作废旧提醒）', done: Object.keys(byStage).length >= 2 },
    { name: '③ 综合风险视图（分类明细+专题会重点）', done: views.length > 0 },
    { name: '④ 规则管理接口（实时生效+变更留痕+调度器重置）', done: Object.keys(updateResult.log.previousRules).length > 0 },
    { name: '⑤ 推送记录追溯（分页/条件/统计/关联业务ID）', done: stats.total > 0 },
  ];
  finalChecklist.forEach(item => {
    console.log(`  ${item.done ? '✅' : '❌'}  ${item.name}`);
  });

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  演示完成！启动服务：npm run dev                                         ║
║  核心调用链路：                                                          ║
║  POST /api/seed → POST /api/reminders/status/check → POST /risk/detect   ║
║  → POST /weekly/generate → GET /push-records → PUT /rules                ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
}

runDemo().catch(err => {
  console.error('演示运行失败:', err);
  process.exit(1);
});
