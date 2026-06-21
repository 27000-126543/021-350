import express from 'express';
import cors from 'cors';
import projectsRouter from './routes/projects.route';
import changesRouter from './routes/changes.route';
import remindersRouter from './routes/reminders.route';
import { dataStore } from './store/dataStore';
import { seedDemoData } from './data/seedData';
import { taskSchedulerService } from './services/taskScheduler.service';
import { statusReminderService } from './services/statusReminder.service';
import { riskAlertService } from './services/riskAlert.service';
import { weeklySummaryService } from './services/weeklySummary.service';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  const rules = dataStore.getReminderRules();
  const tasks = taskSchedulerService.getTaskList();
  res.json({
    status: 'ok',
    service: 'change-negotiation-reminder-service',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    scheduler: {
      enabled: tasks.some(t => t.isRunning),
      tasks: tasks.map(t => ({
        name: t.name,
        running: t.isRunning,
        nextRunAt: t.nextRunAt,
        cron: t.cronExpression,
      })),
    },
    rules: {
      supervisorReviewDays: rules.supervisorReviewDays,
      designReviewDays: rules.designReviewDays,
      designFinalReviewDays: rules.designFinalReviewDays,
      weeklySummary: `每周${['日', '一', '二', '三', '四', '五', '六'][rules.weeklySummaryDay % 7]} ${String(rules.weeklySummaryHour).padStart(2, '0')}:${String(rules.weeklySummaryMinute).padStart(2, '0')}`,
    },
  });
});

app.get('/api', (req, res) => {
  res.json({
    name: '变更洽商智能提醒服务 API v2.0',
    version: '2.0.0',
    description: '面向大型施工企业的智能提醒中心（状态提醒+风险提示+统计推送+规则管理+推送追溯）',
    capabilities: [
      '【状态提醒】三阶段超期检测（登记→监理→设计→闭合），状态推进自动作废旧提醒',
      '【风险提示】分类风险 + 综合风险视图（按项目+专业聚合多类别）+ 专题会重点建议',
      '【统计推送】按配置周几+时间自动生成周报，邮件版/短信版双格式',
      '【规则管理】工程管理部可实时调整天数、阈值、定时策略，变更留痕',
      '【推送追溯】每次提醒/风险/周报均留推送记录，支持按类型/渠道/时间/结果查询',
    ],
    endpoints: {
      projects: 'GET/POST /api/projects',
      changes: 'GET/POST/PUT /api/changes | POST /api/changes/:id/status（带作废联动）',
      reminders: {
        status: 'GET /api/reminders/status?onlyActive=true&format=text | POST /api/reminders/status/check | POST /api/reminders/status/:id/invalidate',
        risk: 'GET /api/reminders/risk | GET /api/reminders/risk/comprehensive（综合视图） | POST /api/reminders/risk/detect',
        weekly: 'GET /api/reminders/weekly?format=text|sms|email | POST /api/reminders/weekly/generate?force=true | GET /api/reminders/weekly/history',
        rules: 'GET /api/reminders/rules | PUT /api/reminders/rules（改后自动重置定时任务）| GET /api/reminders/rules/logs',
        pushRecords: 'GET /api/reminders/push-records（分页+多维过滤）| GET /api/reminders/push-records/statistics | PUT /api/reminders/push-records/:id/result',
        tasks: 'GET /api/reminders/tasks | POST /api/reminders/tasks/start|stop|restart | POST /api/reminders/tasks/:name/trigger',
      },
      seed: 'POST /api/seed（初始化示例数据）',
    },
  });
});

app.post('/api/seed', (req, res) => {
  const { projects, changes } = seedDemoData();
  res.json({
    code: 0,
    message: '示例数据初始化成功，可调用 POST /api/reminders/status/check 和 /risk/detect、/weekly/generate 立即查看三大能力效果',
    data: {
      projects: projects.length,
      changes: changes.length,
    },
  });
});

app.use('/api/projects', projectsRouter);
app.use('/api/changes', changesRouter);
app.use('/api/reminders', remindersRouter);

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    error: err.message,
  });
});

app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: '接口不存在，请访问 GET /api 查看完整接口列表',
    path: req.path,
    method: req.method,
  });
});

const server = app.listen(PORT, () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  变更洽商智能提醒服务 v2.0`);
  console.log(`  面向工程管理部的提醒中心 + 规则管理 + 推送追溯`);
  console.log(`  服务端口: ${PORT}`);
  console.log(`  API 总览: http://localhost:${PORT}/api`);
  console.log(`  健康检查: http://localhost:${PORT}/health`);
  console.log(`${'═'.repeat(60)}\n`);

  const rules = dataStore.getReminderRules();

  console.log(`  ┌─ 当前提醒规则配置 ──────────────────────────────┐`);
  console.log(`  │ 监理意见期限:           ${rules.supervisorReviewDays} 天`);
  console.log(`  │ 设计意见期限:           ${rules.designReviewDays} 天`);
  console.log(`  │ 设计闭合最终期限:       ${rules.designFinalReviewDays} 天`);
  console.log(`  │ 风险时间窗口:           ${rules.riskTimeWindowDays} 天`);
  console.log(`  │ 分类风险阈值:           ${rules.riskThresholdCount} 条 (中) / ${rules.highRiskThresholdCount} 条 (高)`);
  console.log(`  │ 综合风险阈值:           ${rules.comprehensiveRiskThresholdCount} 条`);
  console.log(`  │ 周报自动生成:           ${rules.autoGenerateWeeklySummary ? '每周' + ['日', '一', '二', '三', '四', '五', '六'][rules.weeklySummaryDay % 7] + ' ' + String(rules.weeklySummaryHour).padStart(2, '0') + ':' + String(rules.weeklySummaryMinute).padStart(2, '0') : '关闭'}`);
  console.log(`  │ 状态检测/风险检测:      ${rules.autoRunStatusCheck ? '开启' : '关闭'} / ${rules.autoRunRiskCheck ? '开启' : '关闭'}`);
  console.log(`  └─────────────────────────────────────────────────────┘\n`);

  const schedulerResult = taskSchedulerService.startAll();
  if (schedulerResult.started.length > 0) {
    console.log(`  ✓ 定时任务调度器已启动，共加载 ${schedulerResult.started.length} 个任务：`);
    taskSchedulerService.getTaskList().forEach(t => {
      console.log(`    · ${t.name}  (${t.cronExpression})  →  ${t.description}`);
    });
  } else {
    console.log(`  ℹ  根据当前规则配置，暂无需要自动执行的定时任务`);
  }
  console.log(`\n  快速体验：POST /api/seed → POST /api/reminders/status/check → POST /api/reminders/risk/detect → POST /api/reminders/weekly/generate`);
  console.log(`${'═'.repeat(60)}\n`);
});

function handleShutdown(signal: string) {
  console.log(`\n[${signal}] 正在优雅关闭服务...`);
  const result = taskSchedulerService.stopAll();
  console.log(`  已停止 ${result.stopped.length} 个定时任务`);
  server.close(() => {
    console.log('  HTTP 服务已关闭');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export default app;
