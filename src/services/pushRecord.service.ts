import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  PushRecord,
  PushChannel,
  PushResult,
  StatusReminder,
  RiskAlert,
  WeeklySummary,
  ReminderType,
  PushChannel as PC,
} from '../types';

type Pushable = StatusReminder | RiskAlert | WeeklySummary;

export class PushRecordService {
  createPushRecordForStatusReminder(
    reminder: StatusReminder,
    channels: PushChannel[] = ['system'],
    result: PushResult = 'pending',
    extraRecipients?: { names: string[]; phones: string[]; emails: string[]; ids: string[] }
  ): PushRecord {
    const recipientIds = extraRecipients?.ids || [reminder.recipient];
    const recipientNames = extraRecipients?.names || [reminder.recipient];
    const recipientPhones = extraRecipients?.phones || (reminder.recipientPhone ? [reminder.recipientPhone] : []);
    const recipientEmails = extraRecipients?.emails || (reminder.recipientEmail ? [reminder.recipientEmail] : []);

    const record: PushRecord = {
      id: dataStore.generateId(),
      reminderType: 'status_overdue',
      reminderId: reminder.id,
      channel: channels[0],
      recipientIds,
      recipientNames,
      recipientPhones,
      recipientEmails,
      title: `【超期提醒】${reminder.changeCode} ${reminder.changeTitle}`,
      content: this.formatStatusContent(reminder),
      summary: `洽商${reminder.changeCode}已超期${reminder.overdueDays}天`,
      result,
      generatedAt: dayjs().toISOString(),
      pushedAt: result === 'success' ? dayjs().toISOString() : undefined,
      metadata: {
        channels,
        projectId: reminder.projectId,
        projectName: reminder.projectName,
        changeId: reminder.changeId,
        stage: reminder.stage,
      },
    };

    return dataStore.addPushRecord(record);
  }

  createPushRecordForRiskAlert(
    alert: RiskAlert,
    channels: PushChannel[] = ['system'],
    result: PushResult = 'pending',
    extraRecipients?: { names: string[]; phones: string[]; emails: string[]; ids: string[] }
  ): PushRecord {
    const project = dataStore.getProject(alert.projectId);
    const recipientIds = extraRecipients?.ids || (project ? [project.projectManager] : []);
    const recipientNames = extraRecipients?.names || (project ? [project.projectManager] : []);
    const recipientPhones = extraRecipients?.phones || (project?.projectManagerPhone ? [project.projectManagerPhone] : []);
    const recipientEmails = extraRecipients?.emails || (project?.projectManagerEmail ? [project.projectManagerEmail] : []);

    const record: PushRecord = {
      id: dataStore.generateId(),
      reminderType: 'risk_alert',
      reminderId: alert.id,
      channel: channels[0],
      recipientIds,
      recipientNames,
      recipientPhones,
      recipientEmails,
      title: `【风险${alert.riskLevel === 'high' ? '高' : '提示'}】${alert.projectName} ${alert.changeCount}条变更集中出现`,
      content: this.formatRiskContent(alert),
      summary: `${alert.projectName}出现${alert.changeCount}条同类变更`,
      result,
      generatedAt: dayjs().toISOString(),
      pushedAt: result === 'success' ? dayjs().toISOString() : undefined,
      metadata: {
        channels,
        projectId: alert.projectId,
        projectName: alert.projectName,
        professional: alert.professional,
        category: alert.category,
        riskLevel: alert.riskLevel,
        changeCount: alert.changeCount,
      },
    };

    return dataStore.addPushRecord(record);
  }

  createPushRecordForWeeklySummary(
    summary: WeeklySummary,
    channels: PushChannel[] = ['system', 'email'],
    result: PushResult = 'pending',
    recipients?: { names: string[]; phones: string[]; emails: string[]; ids: string[] }
  ): PushRecord {
    const projects = dataStore.getAllProjects();
    const defaultRecipients = {
      ids: projects.map(p => p.projectManager),
      names: projects.map(p => p.projectManager),
      phones: projects.map(p => p.projectManagerPhone).filter(Boolean) as string[],
      emails: projects.map(p => p.projectManagerEmail || '').filter(Boolean) as string[],
    };

    const finalRecipients = recipients || defaultRecipients;

    const record: PushRecord = {
      id: dataStore.generateId(),
      reminderType: 'weekly_summary',
      reminderId: summary.id,
      channel: channels[0],
      recipientIds: finalRecipients.ids,
      recipientNames: finalRecipients.names,
      recipientPhones: finalRecipients.phones,
      recipientEmails: finalRecipients.emails,
      title: `【周报】${summary.weekStart}~${summary.weekEnd} 变更洽商管理简报`,
      content: summary.summaryText,
      summary: summary.smsText,
      result,
      generatedAt: dayjs().toISOString(),
      pushedAt: result === 'success' ? dayjs().toISOString() : undefined,
      metadata: {
        channels,
        generatedAutomatically: summary.generatedAutomatically,
        weekStart: summary.weekStart,
        weekEnd: summary.weekEnd,
        stats: {
          totalProjects: summary.totalProjects,
          totalNewChanges: summary.totalNewChanges,
          totalClosedChanges: summary.totalClosedChanges,
          overallClosureRate: summary.overallClosureRate,
          totalOverdueCount: summary.totalOverdueCount,
        },
      },
    };

    return dataStore.addPushRecord(record);
  }

  private formatStatusContent(reminder: StatusReminder): string {
    return `【变更洽商超期提醒】
项目名称：${reminder.projectName}
洽商编号：${reminder.changeCode}
洽商标题：${reminder.changeTitle}
当前阶段：${reminder.stage}
已超期：${reminder.overdueDays} 天
登记日期：${reminder.registeredDate}
应完成日期：${reminder.dueDate}
请项目负责人 ${reminder.recipient} 尽快跟进处理，确保资料及时闭合。
——工程管理部智能提醒中心`;
  }

  private formatRiskContent(alert: RiskAlert): string {
    return `【变更洽商风险提示】
风险等级：${alert.riskLevel === 'high' ? '高风险' : '中风险'}
项目名称：${alert.projectName}
变更数量：${alert.changeCount} 条
预计金额：¥${alert.totalEstimatedAmount.toLocaleString()}
时间范围：近 ${alert.timeWindowDays} 天

建议措施：${alert.suggestion}
——工程管理部智能提醒中心`;
  }

  updatePushResult(
    id: string,
    result: PushResult,
    resultMessage?: string,
    channel?: PushChannel
  ): PushRecord | undefined {
    return dataStore.updatePushRecord(id, {
      result,
      resultMessage,
      channel: channel,
      pushedAt: result === 'success' || result === 'failed' ? dayjs().toISOString() : undefined,
    });
  }

  queryPushRecords(params: {
    reminderType?: ReminderType;
    channel?: PushChannel;
    result?: PushResult;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    return dataStore.getPushRecords(params);
  }

  getPushRecordDetail(id: string) {
    return dataStore.getPushRecordById(id);
  }

  getByReminder(reminderType: ReminderType, reminderId: string) {
    return dataStore.getPushRecordsByReminder(reminderType, reminderId);
  }

  getStatistics(fromDate?: string, toDate?: string) {
    return dataStore.getPushStatistics(fromDate, toDate);
  }
}

export const pushRecordService = new PushRecordService();
