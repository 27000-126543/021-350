import { seedDemoData } from '../data/seedData';
import { statusReminderService } from '../services/statusReminder.service';
import { riskAlertService } from '../services/riskAlert.service';
import { weeklySummaryService } from '../services/weeklySummary.service';
import { dataStore } from '../store/dataStore';

async function runDemo() {
  console.log('========================================');
  console.log('  变更洽商智能提醒服务 - 功能演示');
  console.log('========================================\n');

  console.log('【步骤1】初始化示例数据...');
  const { projects, changes } = seedDemoData();
  console.log(`  - 项目数量: ${projects.length}`);
  console.log(`  - 变更洽商数量: ${changes.length}\n`);

  console.log('【步骤2】执行状态提醒检测（能力一：状态提醒）...');
  const newReminders = await statusReminderService.checkAndGenerateReminders();
  console.log(`  - 新生成超期提醒: ${newReminders.length} 条\n`);

  if (newReminders.length > 0) {
    console.log('  超期待办摘要：');
    console.log('  ' + '─'.repeat(60));
    const digest = statusReminderService.formatReminderDigest(newReminders);
    console.log(digest.split('\n').map(line => '  ' + line).join('\n'));
  }

  console.log('\n【步骤3】执行风险提示检测（能力二：风险提示）...');
  const newAlerts = await riskAlertService.detectAndGenerateAlerts();
  console.log(`  - 新生成风险提示: ${newAlerts.length} 条\n`);

  if (newAlerts.length > 0) {
    console.log('  风险提示汇总：');
    console.log('  ' + '─'.repeat(60));
    const digest = riskAlertService.formatAlertDigest(newAlerts);
    console.log(digest.split('\n').map(line => '  ' + line).join('\n'));
    console.log('');

    console.log('  风险详情示例（第一条）：');
    console.log('  ' + '─'.repeat(60));
    const detail = riskAlertService.formatAlertMessage(newAlerts[0]);
    console.log(detail.split('\n').map(line => '  ' + line).join('\n'));
  }

  console.log('\n【步骤4】生成本周管理简报（能力三：统计推送）...');
  const summary = await weeklySummaryService.generateWeeklySummary();
  console.log(`  - 覆盖项目数: ${summary.totalProjects}`);
  console.log(`  - 本周新增: ${summary.totalNewChanges} 条`);
  console.log(`  - 本周闭合: ${summary.totalClosedChanges} 条`);
  console.log(`  - 整体闭合率: ${summary.overallClosureRate}%`);
  console.log(`  - 超期待办: ${summary.totalOverdueCount} 条\n`);

  console.log('  本周管理简报：');
  console.log('  ' + '═'.repeat(60));
  const briefing = weeklySummaryService.formatBriefingEmail(summary);
  console.log(briefing.split('\n').map(line => '  ' + line).join('\n'));

  console.log('\n【步骤5】短信版简报示例：');
  console.log('  ' + weeklySummaryService.formatBriefingSMS(summary));

  console.log('\n========================================');
  console.log('  演示完成！');
  console.log('========================================');
  console.log('\n提示：运行 npm run dev 启动 API 服务，可通过 HTTP 接口调用所有功能。');
}

runDemo().catch(console.error);
