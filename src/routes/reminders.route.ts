import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import { statusReminderService } from '../services/statusReminder.service';
import { riskAlertService } from '../services/riskAlert.service';
import { weeklySummaryService } from '../services/weeklySummary.service';
import { pushRecordService } from '../services/pushRecord.service';
import { taskSchedulerService } from '../services/taskScheduler.service';
import { dataStore } from '../store/dataStore';
import {
  ReminderRules,
  ReminderType,
  PushChannel,
  PushResult,
} from '../types';

const router = Router();

// ============================================================
// 一、状态提醒接口
// ============================================================

router.get('/status', (req: Request, res: Response) => {
  const { projectId, onlyActive, format } = req.query;
  const onlyActiveFlag = String(onlyActive) !== 'false';
  let reminders;

  if (projectId) {
    reminders = statusReminderService.getRemindersByProject(projectId as string, onlyActiveFlag);
  } else {
    reminders = statusReminderService.getAllReminders(onlyActiveFlag);
  }

  if (format === 'text') {
    const text = statusReminderService.formatReminderDigest(reminders);
    res.json({
      code: 0,
      message: 'success',
      data: reminders,
      text,
      total: reminders.length,
    });
    return;
  }

  res.json({
    code: 0,
    message: 'success',
    data: reminders,
    total: reminders.length,
    onlyActive: onlyActiveFlag,
  });
});

router.get('/status/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const reminder = statusReminderService.getAllReminders(false).find(r => r.id === id);
  if (!reminder) {
    res.status(404).json({ code: 404, message: '提醒记录不存在', data: null });
    return;
  }
  res.json({
    code: 0,
    message: 'success',
    data: reminder,
    text: statusReminderService.formatReminderMessage(reminder),
  });
});

router.post('/status/check', async (req: Request, res: Response) => {
  const result = await statusReminderService.checkAndGenerateReminders(true);
  res.json({
    code: 0,
    message: `检测完成：新增${result.reminders.length}条提醒，作废${result.invalidated}条旧提醒，创建${result.pushRecords}条推送记录`,
    data: result,
  });
});

router.post('/status/:id/invalidate', (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason = '人工作废' } = req.body;
  const result = statusReminderService.invalidateReminder(id, reason);
  if (!result) {
    res.status(404).json({ code: 404, message: '提醒记录不存在', data: null });
    return;
  }
  res.json({ code: 0, message: '提醒已作废', data: result });
});

router.post('/status/:id/refresh', (req: Request, res: Response) => {
  const { id } = req.params;
  const result = statusReminderService.refreshReminderOverdue(id);
  if (!result) {
    res.status(404).json({ code: 404, message: '提醒记录不存在或已无法更新', data: null });
    return;
  }
  res.json({ code: 0, message: '超期天数已更新', data: result });
});

// ============================================================
// 二、风险提示接口（分类 + 综合视图）
// ============================================================

router.get('/risk', (req: Request, res: Response) => {
  const { projectId, format } = req.query;
  let alerts;

  if (projectId) {
    alerts = riskAlertService.getAlertsByProject(projectId as string);
  } else {
    alerts = riskAlertService.getAllAlerts();
  }

  if (format === 'text') {
    const text = riskAlertService.formatAlertDigest(alerts);
    res.json({
      code: 0,
      message: 'success',
      data: alerts,
      text,
      total: alerts.length,
    });
    return;
  }

  res.json({
    code: 0,
    message: 'success',
    data: alerts,
    total: alerts.length,
  });
});

router.get('/risk/comprehensive', (req: Request, res: Response) => {
  const { projectId, format } = req.query;
  const views = riskAlertService.getComprehensiveViews(projectId as string | undefined);

  if (format === 'text') {
    const text = views.length > 0
      ? views.map(v => riskAlertService.formatComprehensiveViewText(v, false)).join('\n\n───\n\n')
      : '暂无综合风险预警，各专业情况平稳。';
    res.json({ code: 0, message: 'success', data: views, text, total: views.length });
    return;
  }

  res.json({
    code: 0,
    message: 'success',
    data: views,
    total: views.length,
    summary: {
      high: views.filter(v => v.overallRiskLevel === 'high').length,
      medium: views.filter(v => v.overallRiskLevel === 'medium').length,
      low: views.filter(v => v.overallRiskLevel === 'low').length,
    },
  });
});

router.get('/risk/comprehensive/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const view = riskAlertService.getComprehensiveViewById(id);
  if (!view) {
    res.status(404).json({ code: 404, message: '综合风险视图不存在', data: null });
    return;
  }
  res.json({
    code: 0,
    message: 'success',
    data: view,
    text: riskAlertService.formatComprehensiveViewText(view, true),
  });
});

router.post('/risk/detect', async (req: Request, res: Response) => {
  const result = await riskAlertService.detectAndGenerateAlerts(true);
  res.json({
    code: 0,
    message: `检测完成：新增${result.categoryAlerts.length}条分类风险，${result.comprehensiveViews.length}个综合视图，创建${result.pushRecords}条推送记录`,
    data: result,
  });
});

// ============================================================
// 三、周报接口
// ============================================================

router.get('/weekly', (req: Request, res: Response) => {
  const { format } = req.query;
  const summary = weeklySummaryService.getLatestSummary();

  if (!summary) {
    res.json({
      code: 404,
      message: '暂无周报数据，请先生成或等待定时任务',
      data: null,
      currentWeek: weeklySummaryService.getCurrentWeekRange(),
    });
    return;
  }

  if (format === 'text' || format === 'email') {
    res.json({
      code: 0,
      message: 'success',
      data: summary,
      text: weeklySummaryService.formatBriefingEmail(summary),
    });
    return;
  }

  if (format === 'sms') {
    res.json({
      code: 0,
      message: 'success',
      data: summary,
      text: weeklySummaryService.formatBriefingSMS(summary),
    });
    return;
  }

  res.json({
    code: 0,
    message: 'success',
    data: summary,
  });
});

router.get('/weekly/history', (req: Request, res: Response) => {
  const summaries = weeklySummaryService.getAllSummaries();
  res.json({
    code: 0,
    message: 'success',
    data: summaries,
    total: summaries.length,
  });
});

router.get('/weekly/by-week', (req: Request, res: Response) => {
  const { weekStart, weekEnd } = req.query as any;
  if (!weekStart || !weekEnd) {
    res.status(400).json({ code: 400, message: '请提供 weekStart 和 weekEnd 参数', data: null });
    return;
  }
  const summary = weeklySummaryService.getSummaryByWeek(weekStart, weekEnd);
  if (!summary) {
    res.status(404).json({ code: 404, message: '该周期周报不存在', data: null });
    return;
  }
  res.json({ code: 0, message: 'success', data: summary });
});

router.post('/weekly/generate', async (req: Request, res: Response) => {
  const { force = false } = req.body;
  const isAuto = Boolean(req.body?.isAuto);

  const existing = weeklySummaryService.getLatestSummary();
  const currentWeek = weeklySummaryService.getCurrentWeekRange();
  const existingSameWeek = existing &&
    existing.weekStart === currentWeek.weekStart &&
    existing.weekEnd === currentWeek.weekEnd;

  if (existingSameWeek && !force) {
    res.json({
      code: 1,
      message: '本周周报已存在，如需重新生成请传入 force=true',
      data: existing,
    });
    return;
  }

  const result = await weeklySummaryService.generateWeeklySummary(isAuto, true);
  res.json({
    code: 0,
    message: `周报生成成功（覆盖${result.summary.totalProjects}个项目，创建${result.pushRecordCount}条推送记录）`,
    data: result.summary,
  });
});

// ============================================================
// 四、提醒规则管理接口
// ============================================================

router.get('/rules', (req: Request, res: Response) => {
  const rules = dataStore.getReminderRules();
  res.json({
    code: 0,
    message: 'success',
    data: rules,
    defaults: {
      supervisorReviewDays: 7,
      designReviewDays: 14,
      designFinalReviewDays: 21,
      riskTimeWindowDays: 15,
      riskThresholdCount: 3,
      highRiskThresholdCount: 5,
      comprehensiveRiskThresholdCount: 6,
      weeklySummaryDay: 1,
      weeklySummaryHour: 9,
    },
  });
});

router.put('/rules', (req: Request, res: Response) => {
  const updates = req.body as Partial<ReminderRules>;
  const { changedBy = 'engineering_dept', description = '' } = req.body;

  const validKeys: (keyof ReminderRules)[] = [
    'supervisorReviewDays', 'designReviewDays', 'designFinalReviewDays',
    'riskTimeWindowDays', 'riskThresholdCount', 'highRiskThresholdCount',
    'comprehensiveRiskThresholdCount', 'weeklySummaryDay', 'weeklySummaryHour',
    'weeklySummaryMinute', 'autoRunStatusCheck', 'autoRunRiskCheck',
    'autoGenerateWeeklySummary', 'statusCheckCronExpression', 'riskCheckCronExpression',
  ];

  const filteredUpdates: Partial<ReminderRules> = {};
  for (const key of validKeys) {
    if (updates[key] !== undefined) {
      (filteredUpdates as any)[key] = updates[key];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    res.status(400).json({ code: 400, message: '没有有效的规则字段需要更新', data: null });
    return;
  }

  const result = dataStore.updateReminderRules(
    filteredUpdates,
    changedBy as string,
    description as string
  );

  const needRestartScheduler = [
    'weeklySummaryDay', 'weeklySummaryHour', 'weeklySummaryMinute',
    'statusCheckCronExpression', 'riskCheckCronExpression',
    'autoRunStatusCheck', 'autoRunRiskCheck', 'autoGenerateWeeklySummary',
  ].some(k => filteredUpdates[k as keyof ReminderRules] !== undefined);

  let schedulerResult: any = null;
  if (needRestartScheduler) {
    schedulerResult = taskSchedulerService.restartAll();
  }

  res.json({
    code: 0,
    message: `规则已更新（修改${Object.keys(filteredUpdates).length}项）` +
      (needRestartScheduler ? '，定时任务已按新规则重置' : ''),
    data: result.rules,
    log: result.log,
    schedulerRestarted: needRestartScheduler,
    schedulerInfo: schedulerResult,
  });
});

router.get('/rules/logs', (req: Request, res: Response) => {
  const logs = dataStore.getReminderRulesLogs();
  res.json({
    code: 0,
    message: 'success',
    data: logs,
    total: logs.length,
  });
});

// ============================================================
// 五、推送记录查询接口
// ============================================================

router.get('/push-records', (req: Request, res: Response) => {
  const {
    reminderType, channel, result, fromDate, toDate,
    page = '1', pageSize = '20',
  } = req.query;

  const queryResult = pushRecordService.queryPushRecords({
    reminderType: reminderType as ReminderType | undefined,
    channel: channel as PushChannel | undefined,
    result: result as PushResult | undefined,
    fromDate: fromDate as string | undefined,
    toDate: toDate as string | undefined,
    page: parseInt(page as string, 10),
    pageSize: parseInt(pageSize as string, 10),
  });

  res.json({
    code: 0,
    message: 'success',
    data: queryResult.records,
    total: queryResult.total,
    page: parseInt(page as string, 10),
    pageSize: parseInt(pageSize as string, 10),
    totalPages: Math.ceil(queryResult.total / parseInt(pageSize as string, 10)),
  });
});

router.get('/push-records/statistics', (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query;
  const stats = pushRecordService.getStatistics(
    fromDate as string | undefined,
    toDate as string | undefined
  );
  res.json({
    code: 0,
    message: 'success',
    data: stats,
    range: { fromDate: fromDate || '全部', toDate: toDate || '全部' },
  });
});

router.get('/push-records/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const record = pushRecordService.getPushRecordDetail(id);
  if (!record) {
    res.status(404).json({ code: 404, message: '推送记录不存在', data: null });
    return;
  }
  res.json({ code: 0, message: 'success', data: record });
});

router.get('/push-records/by-reminder/:type/:reminderId', (req: Request, res: Response) => {
  const { type, reminderId } = req.params;
  const records = pushRecordService.getByReminder(
    type as ReminderType,
    reminderId,
  );
  res.json({
    code: 0,
    message: 'success',
    data: records,
    total: records.length,
  });
});

router.put('/push-records/:id/result', (req: Request, res: Response) => {
  const { id } = req.params;
  const { result, resultMessage, channel } = req.body;
  if (!result) {
    res.status(400).json({ code: 400, message: '缺少 result 参数', data: null });
    return;
  }
  const updated = pushRecordService.updatePushResult(
    id,
    result as PushResult,
    resultMessage as string | undefined,
    channel as PushChannel | undefined,
  );
  if (!updated) {
    res.status(404).json({ code: 404, message: '推送记录不存在', data: null });
    return;
  }
  res.json({ code: 0, message: '推送结果已更新', data: updated });
});

// ============================================================
// 六、定时任务管理接口
// ============================================================

router.get('/tasks', (req: Request, res: Response) => {
  const tasks = taskSchedulerService.getTaskList();
  res.json({
    code: 0,
    message: 'success',
    data: tasks,
    serverTime: dayjs().toISOString(),
  });
});

router.get('/tasks/:name/status', (req: Request, res: Response) => {
  const { name } = req.params;
  const status = taskSchedulerService.getTaskStatus(name);
  if (!status) {
    res.status(404).json({ code: 404, message: '任务不存在或从未运行', data: null });
    return;
  }
  res.json({ code: 0, message: 'success', data: status });
});

router.post('/tasks/:name/trigger', async (req: Request, res: Response) => {
  const { name } = req.params;
  const result = await taskSchedulerService.triggerTask(name);
  res.json({
    code: result.success ? 0 : 500,
    message: result.message,
    data: result.result,
  });
});

router.post('/tasks/start', (req: Request, res: Response) => {
  const result = taskSchedulerService.startAll();
  res.json({
    code: 0,
    message: `启动完成：共启动${result.started.length}个任务`,
    data: result,
  });
});

router.post('/tasks/stop', (req: Request, res: Response) => {
  const result = taskSchedulerService.stopAll();
  res.json({
    code: 0,
    message: `已停止${result.stopped.length}个任务`,
    data: result,
  });
});

router.post('/tasks/restart', (req: Request, res: Response) => {
  const result = taskSchedulerService.restartAll();
  res.json({
    code: 0,
    message: `重启完成：停止${result.stopped.length}个，启动${result.started.length}个`,
    data: result,
  });
});

export default router;
