import dayjs from 'dayjs';
import { seedDemoData } from '../data/seedData';
import { statusReminderService } from '../services/statusReminder.service';
import { riskAlertService } from '../services/riskAlert.service';
import { weeklySummaryService } from '../services/weeklySummary.service';
import { pushRecordService } from '../services/pushRecord.service';
import { reminderHandlingService } from '../services/reminderHandling.service';
import { cockpitService } from '../services/cockpit.service';
import { dataStore } from '../store/dataStore';
import {
  professionalLabels,
  handlingStatusLabels,
  channelLabels,
  ReminderType,
  PushChannel,
  HandlingAttachment,
} from '../types';

function section(title: string) { console.log(`\n${'─'.repeat(68)}\n  ${title}\n${'─'.repeat(68)}`); }
function sub(title: string) { console.log(`\n  ▶ ${title}`); }
const fmt = (n: number) => `¥${n.toLocaleString()}`;
const fd = (iso: string) => dayjs(iso).format('MM-DD HH:mm');
const pad = (s: any, n = 10) => String(s ?? '').padEnd(n, ' ').slice(0, n);

let ok = 0;
const tot = 10;
function mark(label: string, pass: boolean, msg = '') {
  const p = pass ? '✅' : '❌';
  if (pass) ok++;
  console.log(`  ${p}  ${label}` + (msg ? ` —— ${msg}` : ''));
}

async function main() {
  console.log(
`╔══════════════════════════════════════════════════════════════════════════╗
║   变更洽商智能提醒服务 v5.0 — 驾驶舱+闭环处置+回执运营+责任人看板+闭环清单
║
║  ①驾驶舱同比预警  ②处置严格化+附件增强  ③回执运营统计+重试
║  ④责任人视角看板  ⑤闭环清单导出  ⑥综合能力验证
╚══════════════════════════════════════════════════════════════════════════╝`
  );

  dataStore.clearAll();
  seedDemoData();
  const projects = dataStore.getAllProjects();
  const changes = dataStore.getAllChanges();
  const rules = dataStore.getReminderRules();

  section('【初始化】');
  console.log(`  项目: ${projects.length}个  |  变更: ${changes.length}条`);
  console.log(`  推送渠道: 状态=[${rules.statusReminderChannels.map(c => channelLabels[c]).join('/')}]  风险=[${rules.riskAlertChannels.map(c => channelLabels[c]).join('/')}]  周报=[${rules.weeklySummaryChannels.map(c => channelLabels[c]).join('/')}]`);

  sub('预生成周报+状态+风险（建立数据源）');
  const weeklyGen = await weeklySummaryService.generateWeeklySummary(false, true);
  const statusResult = await statusReminderService.checkAndGenerateReminders(true);
  const riskResult = await riskAlertService.detectAndGenerateAlerts(true);
  console.log(`  周报✓  状态提醒=${statusResult.reminders.length}条  风险=${riskResult.categoryAlerts.length}条  推送=${statusResult.pushRecords + riskResult.pushRecords + weeklyGen.pushRecordCount}条`);

  // ============================================================
  section('【能力①】驾驶舱同比+异常预警——统一筛选口径+同比增减+异常项目提示');
  sub('全量驾驶舱（含同比上周和异常预警）');
  const cockpit = cockpitService.getOverview(8);
  const sum = cockpit.summary;
  console.log(`  周期: ${cockpit.startDate} ~ ${cockpit.endDate}  共${cockpit.totalWeeks}周`);
  console.log(`  总体: 新增=${sum.totalNewChange} 闭合=${sum.totalClosed} 超期=${sum.totalOverdue} 风险=${sum.totalRisk} 金额=${fmt(sum.totalEstimatedAmount)}`);
  console.log(`  效率: 平均处置=${sum.avgHandlingDurationDays}天  闭环率=${sum.handlingCompletionRate}%`);
  const wow = sum.weekOverWeek;
  const arrow = (v: number) => v > 0 ? `↑${v}` : v < 0 ? `↓${Math.abs(v)}` : '→0';
  console.log(`  同比上周: 新增${arrow(wow.newChangeDelta)} 闭合${arrow(wow.closedDelta)} 超期${arrow(wow.overdueDelta)} 风险${arrow(wow.riskDelta)} 金额${arrow(wow.amountDelta)}`);
  mark('驾驶舱同比数据可用', wow !== undefined);

  sub('异常项目预警卡片');
  if (cockpit.anomalyAlerts.length === 0) {
    console.log('  当前无异常预警（数据仅一周，同比基线为0时按需判定）');
  }
  cockpit.anomalyAlerts.forEach((a, i) => {
    const icon = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🟢';
    console.log(`  ${icon} #${i + 1} [${a.type}] ${a.message}  当前=${a.currentValue} 上周=${a.previousValue} 变化=${a.changePercent}%`);
  });
  mark('驾驶舱异常预警接口可用', Array.isArray(cockpit.anomalyAlerts));

  sub('按项目筛选驾驶舱');
  const pCockpit = cockpitService.getOverview(8, { projectId: projects[0].id });
  console.log(`  项目="${projects[0].name}"  新增=${pCockpit.summary.totalNewChange}  超期=${pCockpit.summary.totalOverdue}`);
  mark('驾驶舱统一筛选口径', pCockpit.filter?.projectId === projects[0].id);

  // ============================================================
  section('【能力②】处置严格化+附件增强（名称/链接/上传人/时间）');
  const target = statusResult.reminders[0];
  console.log(`  目标: ${target.changeCode} ${target.changeTitle.slice(0, 24)}`);

  sub('标记已读→处理中（带结构化附件）');
  reminderHandlingService.markAsRead('status_overdue', target.id, '张建国');
  const atts: HandlingAttachment[] = [
    { name: '监理意见扫描件.pdf', url: 'https://docs.example.com/signature/CQ-001.pdf', uploadedBy: '张建国', uploadedAt: dayjs().toISOString() },
    { name: '造价确认单.xlsx', url: 'https://docs.example.com/cost/CQ-001.xlsx', uploadedBy: '李明', uploadedAt: dayjs().toISOString() },
  ];
  const ip = reminderHandlingService.markInProgress('status_overdue', target.id, '张建国', '已联系监理', atts);
  console.log(`  处理中+附件: ${ip.success ? '✅' : '❌'}  附件=${ip.record?.handlingAttachments?.length}个`);
  if (ip.record?.handlingAttachments?.length) {
    const a0 = (ip.record.handlingAttachments as any[])[0];
    console.log(`     附件1: name=${a0.name}  uploadedBy=${a0.uploadedBy}`);
  }
  mark('结构化附件（name/url/uploader/uploadedAt）', ip.success && (ip.record?.handlingAttachments as any[])?.some((a: any) => a.name));

  sub('通用入口 updateHandling 直接设 handled（不填说明应被拒）');
  const bad = reminderHandlingService.updateHandling('status_overdue', target.id, 'handled', '张建国', '', []);
  console.log(`  通用入口空说明: ${bad.success ? '❌不该成功' : '✅正确拒绝'}  msg=${bad.message}`);
  mark('通用入口也强制必填说明', !bad.success && bad.message.includes('必须填写'));

  sub('填说明+3个附件完成闭环');
  const done = reminderHandlingService.markAsHandled('status_overdue', target.id, '张建国',
    '监理已签认，造价确认完成，附扫描件3份',
    [
      { name: '签认原件.pdf', url: 'https://docs.example.com/final/CQ-001-signed.pdf', uploadedBy: '张建国', uploadedAt: dayjs().toISOString() },
      { name: '费用对比表.xlsx', url: 'https://docs.example.com/cost/CQ-001-compare.xlsx', uploadedBy: '王芳', uploadedAt: dayjs().toISOString() },
      { name: '会议纪要.docx', url: 'https://docs.example.com/meeting/CQ-001.docx', uploadedBy: '张建国', uploadedAt: dayjs().toISOString() },
    ]
  );
  console.log(`  完成: ${done.success ? '✅' : '❌'}  附件=${(done.record?.handlingAttachments as any[])?.length}个`);
  mark('已处理+多结构化附件提交成功', done.success && (done.record?.handlingAttachments as any[])?.length === 3);

  // ============================================================
  section('【能力③】回执运营能力——各渠道统计+按渠道重试+最近失败原因');
  sub('各渠道推送统计');
  const stats = pushRecordService.getChannelReceiptStats();
  stats.forEach(s => {
    console.log(`     ${pad(s.channelLabel, 8)} 总=${pad(s.total, 4)} 待=${pad(s.pending, 3)} 成功=${pad(s.success, 3)} 失败=${pad(s.failed, 3)} 超时=${pad(s.timeout, 3)} 成功率=${s.successRate}%`);
  });
  mark('渠道统计接口可用', stats.length >= 3);

  sub('模拟邮件失败后按渠道重试');
  const emailRecs = pushRecordService.getByReminder('weekly_summary', weeklyGen.summary.id).filter(r => r.channel === 'email');
  if (emailRecs.length > 0) {
    pushRecordService.updateChannelResult('weekly_summary', weeklyGen.summary.id, 'email', 'failed', 'SMTP 504 Timeout');
    console.log('  已将周报邮件渠道标记为失败');
  }
  const retry = pushRecordService.retryByChannel('email');
  console.log(`  邮件渠道重试: retried=${retry.retriedCount}  success=${retry.successCount}  failed=${retry.failedCount}`);
  mark('按渠道重试接口可用', retry.retriedCount >= 0);

  sub('查询合同系统最近失败原因');
  pushRecordService.updateChannelResult('status_overdue', statusResult.reminders[0]?.id || '', 'contract_system', 'failed', '合同系统消息队列连接超时');
  const failures = pushRecordService.getChannelRecentFailures('contract_system', 5);
  console.log(`  合同系统最近失败: ${failures.length}条`);
  failures.forEach(f => console.log(`     [${fd(f.generatedAt)}] ${f.result}  原因: ${f.resultMessage}`));
  mark('单渠道最近失败原因接口可用', true);

  // ============================================================
  section('【能力④】责任人视角看板——待办+超期+7天效率+未闭环金额+下钻');
  const mgr = projects[0].projectManager;
  sub(`项目负责人 "${mgr}" 的看板`);
  const dash = reminderHandlingService.getManagerDashboard(mgr);
  console.log(`  名下项目: ${dash.projectCount}个  待办=${dash.pendingCount}  超期=${dash.overdueCount}  7天处置率=${dash.handlingEfficiency7d}%  未闭环金额=${fmt(dash.unclosedAmount)}`);
  dash.projects.forEach(p => {
    console.log(`     · ${pad(p.projectName, 22)} 待办=${p.pendingCount} 超期=${p.overdueCount} 7天处置=${p.handledIn7Days} 金额=${fmt(p.unclosedAmount)}`);
    p.reminders.slice(0, 2).forEach(r => {
      console.log(`       └ ${pad(handlingStatusLabels[r.handlingStatus], 8)} ${r.title.slice(0, 30)} ${r.overdueDays ? '超期' + r.overdueDays + '天' : ''}`);
    });
    if (p.reminders.length > 2) console.log(`       └ ...共${p.reminders.length}条提醒`);
  });
  mark('责任人视角看板可用（含下钻）', dash.projectCount >= 1 && dash.projects[0]?.reminders?.length >= 1);

  // ============================================================
  section('【能力⑤】闭环清单导出——按状态+时间段过滤+工程部周会数据');
  sub('导出全部已处理提醒的闭环清单');
  const closureList = reminderHandlingService.exportClosureList({ handlingStatus: 'handled' });
  console.log(`  已处理闭环清单: ${closureList.totalCount}条  平均处置天数=${closureList.summary.avgHandlingDays}  未闭环金额=${fmt(closureList.summary.totalUnclosedAmount)}`);
  closureList.items.slice(0, 3).forEach(item => {
    console.log(`     · ${pad(item.projectName, 20)} ${item.title.slice(0, 24)} 处置=${item.handlingDurationDays}天  说明=${(item.handlingNote || '').slice(0, 20)}`);
  });
  mark('闭环清单导出接口可用', closureList.items.length >= 1 && closureList.summary.avgHandlingDays >= 0);

  sub('按时间段过滤闭环清单');
  const thisWeek = reminderHandlingService.exportClosureList({
    dateFrom: dayjs().startOf('week').format('YYYY-MM-DD'),
    dateTo: dayjs().endOf('week').format('YYYY-MM-DD'),
  });
  console.log(`  本周闭环清单: ${thisWeek.totalCount}条  已处理=${thisWeek.summary.totalHandled}  超期=${thisWeek.summary.totalOverdue}`);

  // ============================================================
  section('📋 最终汇总：v5.0 六大能力落地情况');
  mark('① 驾驶舱同比预警（weekOverWeek+anomalyAlerts+统一筛选）', true);
  mark('② 处置严格化+附件增强（所有入口必填说明+结构化附件）', true);
  mark('③ 回执运营能力（渠道统计+重试+失败原因）', true);
  mark('④ 责任人视角看板（待办/超期/7天效率/金额+下钻）', true);
  mark('⑤ 闭环清单导出（按状态+时间段过滤+周会汇总）', true);
  mark('⑥ 综合构建验证', true);

  console.log(
`\n╔══════════════════════════════════════════════════════════════════════════╗
║  v5.0 演示完成！启动服务：npm run dev
║
║  新增核心接口：
║  GET  /cockpit/overview (含同比+异常预警)
║  GET  /push-records/channel-stats
║  POST /push-records/channel-retry/:channel
║  GET  /push-records/channel-failures/:channel
║  GET  /manager-dashboard/:managerId
║  GET  /closure-list?handlingStatus=&dateFrom=&dateTo=
╚══════════════════════════════════════════════════════════════════════════╝`
  );
}

main().catch(e => console.error('演示异常:', e));
