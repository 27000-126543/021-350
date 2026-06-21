import { Router, Request, Response } from 'express';
import { statusReminderService } from '../services/statusReminder.service';
import { riskAlertService } from '../services/riskAlert.service';
import { weeklySummaryService } from '../services/weeklySummary.service';

const router = Router();

router.get('/status', (req: Request, res: Response) => {
  const { projectId, format } = req.query;
  let reminders;

  if (projectId) {
    reminders = statusReminderService.getRemindersByProject(projectId as string);
  } else {
    reminders = statusReminderService.getAllReminders();
  }

  if (format === 'text') {
    const text = statusReminderService.formatReminderDigest(reminders);
    res.json({
      code: 0,
      message: 'success',
      data: reminders,
      text,
    });
    return;
  }

  res.json({
    code: 0,
    message: 'success',
    data: reminders,
    total: reminders.length,
  });
});

router.post('/status/check', async (req: Request, res: Response) => {
  const newReminders = await statusReminderService.checkAndGenerateReminders();
  res.json({
    code: 0,
    message: `检测完成，新生成 ${newReminders.length} 条超期提醒`,
    data: newReminders,
    newCount: newReminders.length,
  });
});

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

router.post('/risk/detect', async (req: Request, res: Response) => {
  const newAlerts = await riskAlertService.detectAndGenerateAlerts();
  res.json({
    code: 0,
    message: `检测完成，新生成 ${newAlerts.length} 条风险提示`,
    data: newAlerts,
    newCount: newAlerts.length,
  });
});

router.get('/weekly', (req: Request, res: Response) => {
  const { format } = req.query;
  const summary = weeklySummaryService.getLatestSummary();

  if (!summary) {
    res.json({
      code: 404,
      message: '暂无周报数据，请先生成',
      data: null,
    });
    return;
  }

  if (format === 'text' || format === 'email') {
    const text = weeklySummaryService.formatBriefingEmail(summary);
    res.json({
      code: 0,
      message: 'success',
      data: summary,
      text,
    });
    return;
  }

  if (format === 'sms') {
    const text = weeklySummaryService.formatBriefingSMS(summary);
    res.json({
      code: 0,
      message: 'success',
      data: summary,
      text,
    });
    return;
  }

  res.json({
    code: 0,
    message: 'success',
    data: summary,
  });
});

router.post('/weekly/generate', async (req: Request, res: Response) => {
  const summary = await weeklySummaryService.generateWeeklySummary();
  res.json({
    code: 0,
    message: '周报生成成功',
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

export default router;
