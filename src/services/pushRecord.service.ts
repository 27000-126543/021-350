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
  ): PushRecord[] {
    const recipientIds = extraRecipients?.ids || [reminder.recipient];
    const recipientNames = extraRecipients?.names || [reminder.recipient];
    const recipientPhones = extraRecipients?.phones || (reminder.recipientPhone ? [reminder.recipientPhone] : []);
    const recipientEmails = extraRecipients?.emails || (reminder.recipientEmail ? [reminder.recipientEmail] : []);

    const records: PushRecord[] = [];
    const now = dayjs().toISOString();

    for (const channel of channels) {
      const record: PushRecord = {
        id: dataStore.generateId(),
        reminderType: 'status_overdue',
        reminderId: reminder.id,
        channel,
        recipientIds,
        recipientNames,
        recipientPhones,
        recipientEmails,
        title: `【超期提醒】${reminder.changeCode} ${reminder.changeTitle}`,
        content: this.formatStatusContent(reminder, channel),
        summary: `洽商${reminder.changeCode}已超期${reminder.overdueDays}天`,
        result,
        generatedAt: now,
        pushedAt: result === 'success' ? now : undefined,
        metadata: {
          channels,
          projectId: reminder.projectId,
          projectName: reminder.projectName,
          changeId: reminder.changeId,
          stage: reminder.stage,
        },
      };
      records.push(dataStore.addPushRecord(record));
    }

    return records;
  }

  createPushRecordForRiskAlert(
    alert: RiskAlert,
    channels: PushChannel[] = ['system'],
    result: PushResult = 'pending',
    extraRecipients?: { names: string[]; phones: string[]; emails: string[]; ids: string[] }
  ): PushRecord[] {
    const project = dataStore.getProject(alert.projectId);
    const recipientIds = extraRecipients?.ids || (project ? [project.projectManager] : []);
    const recipientNames = extraRecipients?.names || (project ? [project.projectManager] : []);
    const recipientPhones = extraRecipients?.phones || (project?.projectManagerPhone ? [project.projectManagerPhone] : []);
    const recipientEmails = extraRecipients?.emails || (project?.projectManagerEmail ? [project.projectManagerEmail] : []);

    const records: PushRecord[] = [];
    const now = dayjs().toISOString();

    for (const channel of channels) {
      const record: PushRecord = {
        id: dataStore.generateId(),
        reminderType: 'risk_alert',
        reminderId: alert.id,
        channel,
        recipientIds,
        recipientNames,
        recipientPhones,
        recipientEmails,
        title: `【风险${alert.riskLevel === 'high' ? '高' : '提示'}】${alert.projectName} ${alert.changeCount}条变更集中出现`,
        content: this.formatRiskContent(alert, channel),
        summary: `${alert.projectName}出现${alert.changeCount}条同类变更`,
        result,
        generatedAt: now,
        pushedAt: result === 'success' ? now : undefined,
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
      records.push(dataStore.addPushRecord(record));
    }

    return records;
  }

  createPushRecordForWeeklySummary(
    summary: WeeklySummary,
    channels: PushChannel[] = ['system', 'email'],
    result: PushResult = 'pending',
    recipients?: { names: string[]; phones: string[]; emails: string[]; ids: string[] }
  ): PushRecord[] {
    const projects = dataStore.getAllProjects();
    const defaultRecipients = {
      ids: projects.map(p => p.projectManager),
      names: projects.map(p => p.projectManager),
      phones: projects.map(p => p.projectManagerPhone).filter(Boolean) as string[],
      emails: projects.map(p => p.projectManagerEmail || '').filter(Boolean) as string[],
    };

    const finalRecipients = recipients || defaultRecipients;
    const records: PushRecord[] = [];
    const now = dayjs().toISOString();

    for (const channel of channels) {
      const record: PushRecord = {
        id: dataStore.generateId(),
        reminderType: 'weekly_summary',
        reminderId: summary.id,
        channel,
        recipientIds: finalRecipients.ids,
        recipientNames: finalRecipients.names,
        recipientPhones: finalRecipients.phones,
        recipientEmails: finalRecipients.emails,
        title: `【周报】${summary.weekStart}~${summary.weekEnd} 变更洽商管理简报`,
        content: channel === 'sms' ? summary.smsText : summary.summaryText,
        summary: summary.smsText,
        result,
        generatedAt: now,
        pushedAt: result === 'success' ? now : undefined,
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
      records.push(dataStore.addPushRecord(record));
    }

    return records;
  }

  private formatStatusContent(reminder: StatusReminder, channel: PushChannel = 'system'): string {
    const base = `洽商${reminder.changeCode}超期${reminder.overdueDays}天（${reminder.projectName}）`;
    if (channel === 'sms') {
      return `【变更洽商提醒】${base}，请${reminder.recipient}尽快处理。——工程管理部`;
    }
    if (channel === 'wecom') {
      return `【变更洽商超期提醒】
> 项目：${reminder.projectName}
> 洽商：${reminder.changeCode} ${reminder.changeTitle}
> 阶段：${reminder.stage}
> 超期：${reminder.overdueDays} 天
> 负责人：${reminder.recipient}
请及时跟进处理并在系统中填报处置情况。`;
    }
    if (channel === 'contract_system') {
      return `STATUS_OVERDUE|${reminder.changeId}|${reminder.projectId}|${reminder.overdueDays}|${reminder.stage}`;
    }
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

  private formatRiskContent(alert: RiskAlert, channel: PushChannel = 'system'): string {
    if (channel === 'sms') {
      return `【风险提示】${alert.projectName}近${alert.timeWindowDays}天出现${alert.changeCount}条同类变更，建议关注。——工程管理部`;
    }
    if (channel === 'wecom') {
      return `【变更洽商风险${alert.riskLevel === 'high' ? '高' : '提示'}】
> 项目：${alert.projectName}
> 专业：${alert.professional}
> 类型：${alert.category}
> 近${alert.timeWindowDays}天：${alert.changeCount}条  金额：¥${alert.totalEstimatedAmount.toLocaleString()}
建议：${alert.suggestion}`;
    }
    if (channel === 'contract_system') {
      return `RISK_ALERT|${alert.id}|${alert.projectId}|${alert.professional}|${alert.riskLevel}|${alert.changeCount}`;
    }
    return `【变更洽商风险提示】
风险等级：${alert.riskLevel === 'high' ? '高风险' : '中风险'}
项目名称：${alert.projectName}
变更数量：${alert.changeCount} 条
预计金额：¥${alert.totalEstimatedAmount.toLocaleString()}
时间范围：近 ${alert.timeWindowDays} 天

建议措施：${alert.suggestion}
——工程管理部智能提醒中心`;
  }

  updateChannelResult(
    reminderType: ReminderType,
    reminderId: string,
    channel: PushChannel,
    result: 'success' | 'failed',
    resultMessage?: string
  ): { success: boolean; message?: string; records?: PushRecord[] } {
    const updated = dataStore.updatePushRecordChannelResult(reminderType, reminderId, channel, result, resultMessage);
    if (!updated) {
      return {
        success: false,
        message: `未找到对应的推送记录[提醒类型=${reminderType}, 提醒ID=${reminderId}, 渠道=${channel}]，请先确认该渠道已创建推送记录后再回写`,
      };
    }
    return { success: true, records: updated };
  }

  batchUpdateChannelResults(
    items: { reminderType: ReminderType; reminderId: string; channel: PushChannel; result: 'success' | 'failed'; resultMessage?: string }[]
  ): { success: number; failed: number; notFound: number; updated: PushRecord[]; failures: { item: any; message: string }[] } {
    let successCount = 0;
    let failCount = 0;
    let notFoundCount = 0;
    const allUpdated: PushRecord[] = [];
    const failures: { item: any; message: string }[] = [];
    for (const item of items) {
      try {
        const updated = dataStore.updatePushRecordChannelResult(
          item.reminderType,
          item.reminderId,
          item.channel,
          item.result,
          item.resultMessage
        );
        if (!updated) {
          notFoundCount++;
          failures.push({
            item,
            message: `未找到推送记录[提醒类型=${item.reminderType}, 提醒ID=${item.reminderId}, 渠道=${item.channel}]`,
          });
        } else {
          successCount++;
          allUpdated.push(...updated);
        }
      } catch (e) {
        failCount++;
        failures.push({ item, message: `处理异常: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    return { success: successCount, failed: failCount, notFound: notFoundCount, updated: allUpdated, failures };
  }

  getByReminderGrouped(reminderType: ReminderType, reminderId: string) {
    return dataStore.getPushRecordsByReminderGrouped(reminderType, reminderId);
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
