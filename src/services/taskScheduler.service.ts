import * as cron from 'node-cron';
import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import { statusReminderService } from './statusReminder.service';
import { riskAlertService } from './riskAlert.service';
import { weeklySummaryService } from './weeklySummary.service';

export interface ScheduledTask {
  name: string;
  cronExpression: string;
  description: string;
  nextRunAt: string | null;
  isRunning: boolean;
}

type ScheduledTaskRef = any;

export class TaskSchedulerService {
  private tasks: Map<string, ScheduledTaskRef> = new Map();
  private taskStatus: Map<string, { lastRunAt?: string; lastRunResult?: string; runCount: number }> = new Map();

  startAll(): { started: string[]; messages: string[] } {
    const started: string[] = [];
    const messages: string[] = [];
    const rules = dataStore.getReminderRules();

    if (rules.autoRunStatusCheck) {
      const statusExpr = rules.statusCheckCronExpression || '0 */6 * * *';
      this.registerTask('status_check', statusExpr, '每6小时执行一次超期提醒检测', async () => {
        const result = await statusReminderService.checkAndGenerateReminders(true);
        return `生成${result.reminders.length}条提醒，作废${result.invalidated}条旧提醒`;
      });
      started.push('status_check');
      messages.push(`超期提醒检测任务已启动（${statusExpr}）`);
    }

    if (rules.autoRunRiskCheck) {
      const riskExpr = rules.riskCheckCronExpression || '0 8,14,18 * * *';
      this.registerTask('risk_check', riskExpr, '每日8/14/18点执行风险检测', async () => {
        const result = await riskAlertService.detectAndGenerateAlerts(true);
        return `生成${result.categoryAlerts.length}条分类风险，${result.comprehensiveViews.length}个综合视图`;
      });
      started.push('risk_check');
      messages.push(`风险检测任务已启动（${riskExpr}）`);
    }

    if (rules.autoGenerateWeeklySummary) {
      const weeklyExpr = this.buildWeeklyCronExpression(
        rules.weeklySummaryDay,
        rules.weeklySummaryHour,
        rules.weeklySummaryMinute
      );
      this.registerTask('weekly_summary', weeklyExpr, `每周${this.dayName(rules.weeklySummaryDay)} ${String(rules.weeklySummaryHour).padStart(2, '0')}:${String(rules.weeklySummaryMinute).padStart(2, '0')}生成周报`, async () => {
        const result = await weeklySummaryService.generateWeeklySummary(true, true);
        return `周报生成完成（覆盖${result.summary.totalProjects}个项目），推送记录已创建`;
      });
      started.push('weekly_summary');
      messages.push(`周报自动生成任务已启动（${weeklyExpr}）`);
    }

    return { started, messages };
  }

  stopAll(): { stopped: string[] } {
    const stopped: string[] = [];
    for (const [name, task] of this.tasks.entries()) {
      task.stop();
      stopped.push(name);
    }
    this.tasks.clear();
    return { stopped };
  }

  restartAll(): { stopped: string[]; started: string[]; messages: string[] } {
    const stopped = this.stopAll().stopped;
    const result = this.startAll();
    return { stopped, ...result };
  }

  private registerTask(
    name: string,
    cronExpression: string,
    description: string,
    handler: () => Promise<string>
  ): void {
    try {
      const task = cron.schedule(cronExpression, async () => {
        const startTime = dayjs();
        console.log(`[Scheduler] 开始执行任务: ${name} (${startTime.format('YYYY-MM-DD HH:mm:ss')})`);
        try {
          const result = await handler();
          const endTime = dayjs();
          this.taskStatus.set(name, {
            lastRunAt: endTime.toISOString(),
            lastRunResult: `成功：${result}`,
            runCount: (this.taskStatus.get(name)?.runCount || 0) + 1,
          });
          console.log(`[Scheduler] 任务完成: ${name}，耗时${endTime.diff(startTime, 'second')}秒，${result}`);
        } catch (err: any) {
          const endTime = dayjs();
          this.taskStatus.set(name, {
            lastRunAt: endTime.toISOString(),
            lastRunResult: `失败：${err.message}`,
            runCount: (this.taskStatus.get(name)?.runCount || 0) + 1,
          });
          console.error(`[Scheduler] 任务失败: ${name}，错误:`, err.message);
        }
      }, {
        timezone: 'Asia/Shanghai',
      } as any);

      this.tasks.set(name, task);
      this.taskStatus.set(name, { runCount: 0 });
    } catch (err: any) {
      console.error(`[Scheduler] 注册任务失败 ${name}:`, err.message);
    }
  }

  async triggerTask(name: string): Promise<{ success: boolean; message: string; result?: any }> {
    try {
      let result: any;
      let message: string;

      switch (name) {
        case 'status_check':
          result = await statusReminderService.checkAndGenerateReminders(true);
          message = `生成${result.reminders.length}条提醒，作废${result.invalidated}条旧提醒`;
          break;
        case 'risk_check':
          result = await riskAlertService.detectAndGenerateAlerts(true);
          message = `生成${result.categoryAlerts.length}条分类风险，${result.comprehensiveViews.length}个综合视图`;
          break;
        case 'weekly_summary':
          result = await weeklySummaryService.generateWeeklySummary(false, true);
          message = `周报生成完成（覆盖${result.summary.totalProjects}个项目）`;
          break;
        default:
          return { success: false, message: `未知任务: ${name}` };
      }

      this.taskStatus.set(name, {
        lastRunAt: dayjs().toISOString(),
        lastRunResult: `手动触发成功：${message}`,
        runCount: (this.taskStatus.get(name)?.runCount || 0) + 1,
      });

      return { success: true, message, result };
    } catch (err: any) {
      return { success: false, message: `执行失败：${err.message}` };
    }
  }

  getTaskList(): ScheduledTask[] {
    const allTasks = [
      { name: 'status_check', cron: dataStore.getReminderRules().statusCheckCronExpression || '0 */6 * * *', desc: '每6小时超期提醒检测' },
      { name: 'risk_check', cron: dataStore.getReminderRules().riskCheckCronExpression || '0 8,14,18 * * *', desc: '每日三次风险检测' },
      {
        name: 'weekly_summary',
        cron: (() => {
          const r = dataStore.getReminderRules();
          return this.buildWeeklyCronExpression(r.weeklySummaryDay, r.weeklySummaryHour, r.weeklySummaryMinute);
        })(),
        desc: '周报自动生成',
      },
    ];

    return allTasks.map(t => {
      const status = this.taskStatus.get(t.name);
      const cronTask = this.tasks.get(t.name);
      let nextRunAt: string | null = null;
      try {
        if (cronTask) {
          const nextDates = (cronTask as any).nextDates?.(1) || [];
          if (nextDates && nextDates.length > 0) {
            nextRunAt = dayjs(nextDates[0].toDate?.() || nextDates[0]).toISOString();
          }
        }
      } catch { /* ignore */ }

      return {
        name: t.name,
        cronExpression: t.cron,
        description: t.desc + (status?.lastRunAt ? ` | 上次运行: ${dayjs(status.lastRunAt).format('MM-DD HH:mm')}` : ''),
        nextRunAt,
        isRunning: this.tasks.has(t.name),
      };
    });
  }

  getTaskStatus(name: string) {
    const status = this.taskStatus.get(name);
    if (!status) return null;
    return {
      name,
      ...status,
    };
  }

  private buildWeeklyCronExpression(dayOfWeek: number, hour: number, minute: number): string {
    const day = dayOfWeek === 0 ? 0 : dayOfWeek;
    return `${minute} ${hour} * * ${day}`;
  }

  private dayName(day: number): string {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return names[day % 7];
  }
}

export const taskSchedulerService = new TaskSchedulerService();
