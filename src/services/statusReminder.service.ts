import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  StatusReminder,
  ChangeNegotiation,
  Project,
  ChangeStatus,
  categoryLabels,
  statusLabels,
  ReminderStage,
  stageLabels,
} from '../types';
import { pushRecordService } from './pushRecord.service';

export class StatusReminderService {
  async checkAndGenerateReminders(autoCreatePushRecords: boolean = true): Promise<{
    reminders: StatusReminder[];
    invalidated: number;
    pushRecords: number;
  }> {
    const rules = dataStore.getReminderRules();
    const allChanges = dataStore.getAllChanges();
    const newReminders: StatusReminder[] = [];
    let totalInvalidated = 0;

    for (const change of allChanges) {
      const invalidated = dataStore.invalidateRemindersForChange(change.id, change.status);
      totalInvalidated += invalidated.length;

      if (change.status === 'closed' || change.status === 'rejected') {
        continue;
      }

      const stageResult = this.resolveStage(change, rules);
      if (!stageResult) continue;

      const { isOverdue, overdueDays, dueDate, stage, stageStartDate } = stageResult;
      if (!isOverdue || overdueDays <= 0) continue;

      const existing = dataStore.getStatusReminderByChangeAndStage(change.id, stage);
      if (existing && existing.isActive) continue;

      const project = dataStore.getProject(change.projectId);
      if (!project) continue;

      const now = dayjs().toISOString();
      const reminder: StatusReminder = {
        id: dataStore.generateId(),
        type: 'status_overdue',
        projectId: change.projectId,
        projectName: project.name,
        changeId: change.id,
        changeCode: change.code,
        changeTitle: change.title,
        category: change.category,
        professional: change.professional,
        overdueDays,
        currentStatus: change.status,
        stage,
        isActive: true,
        registeredDate: change.registeredDate,
        stageStartDate,
        dueDate,
        recipient: project.projectManager,
        recipientPhone: project.projectManagerPhone,
        recipientEmail: project.projectManagerEmail,
        createdAt: now,
        lastUpdatedAt: now,
      };

      dataStore.addStatusReminder(reminder);
      newReminders.push(reminder);
    }

    let pushRecordCount = 0;
    if (autoCreatePushRecords) {
      for (const reminder of newReminders) {
        pushRecordService.createPushRecordForStatusReminder(reminder, ['system'], 'pending');
        pushRecordCount++;
      }
    }

    return {
      reminders: newReminders,
      invalidated: totalInvalidated,
      pushRecords: pushRecordCount,
    };
  }

  private resolveStage(
    change: ChangeNegotiation,
    rules: { supervisorReviewDays: number; designReviewDays: number; designFinalReviewDays: number }
  ): {
    isOverdue: boolean;
    overdueDays: number;
    dueDate: string;
    stage: ReminderStage;
    stageStartDate: string;
  } | null {
    const now = dayjs();
    const registeredDate = dayjs(change.registeredDate);
    const supervisorOpinionDate = change.supervisorOpinionDate
      ? dayjs(change.supervisorOpinionDate)
      : null;
    const designOpinionDate = change.designOpinionDate
      ? dayjs(change.designOpinionDate)
      : null;

    switch (change.status) {
      case 'registered': {
        const reviewDays = rules.supervisorReviewDays;
        const dueDate = registeredDate.add(reviewDays, 'day');
        return {
          isOverdue: now.isAfter(dueDate),
          overdueDays: Math.max(0, now.diff(dueDate, 'day')),
          dueDate: dueDate.format('YYYY-MM-DD'),
          stage: 'registered_to_supervisor',
          stageStartDate: change.registeredDate,
        };
      }

      case 'supervisor_review': {
        const baseDate = supervisorOpinionDate || registeredDate.add(rules.supervisorReviewDays, 'day');
        const reviewDays = rules.designReviewDays;
        const dueDate = baseDate.add(reviewDays, 'day');
        return {
          isOverdue: now.isAfter(dueDate),
          overdueDays: Math.max(0, now.diff(dueDate, 'day')),
          dueDate: dueDate.format('YYYY-MM-DD'),
          stage: 'supervisor_to_design',
          stageStartDate: baseDate.format('YYYY-MM-DD'),
        };
      }

      case 'design_review': {
        const baseDate = designOpinionDate ||
          (supervisorOpinionDate || registeredDate.add(rules.supervisorReviewDays, 'day')).add(rules.designReviewDays, 'day');
        const reviewDays = rules.designFinalReviewDays;
        const dueDate = baseDate.add(reviewDays, 'day');
        return {
          isOverdue: now.isAfter(dueDate),
          overdueDays: Math.max(0, now.diff(dueDate, 'day')),
          dueDate: dueDate.format('YYYY-MM-DD'),
          stage: 'design_to_close',
          stageStartDate: baseDate.format('YYYY-MM-DD'),
        };
      }

      default:
        return null;
    }
  }

  getRemindersByProject(projectId: string, onlyActive: boolean = true): StatusReminder[] {
    return dataStore.getStatusRemindersByProject(projectId, onlyActive);
  }

  getAllReminders(onlyActive: boolean = true): StatusReminder[] {
    return dataStore.getAllStatusReminders(onlyActive);
  }

  getOverdueChanges(projectId?: string): ChangeNegotiation[] {
    const rules = dataStore.getReminderRules();
    const changes = projectId
      ? dataStore.getChangesByProject(projectId)
      : dataStore.getAllChanges();

    return changes.filter(change => {
      if (change.status === 'closed' || change.status === 'rejected') return false;
      const result = this.resolveStage(change, rules);
      return result?.isOverdue || false;
    });
  }

  invalidateReminder(reminderId: string, reason: string): StatusReminder | undefined {
    return dataStore.updateStatusReminder(reminderId, {
      isActive: false,
      invalidatedAt: dayjs().toISOString(),
      invalidatedReason: reason,
    });
  }

  refreshReminderOverdue(reminderId: string): StatusReminder | undefined {
    const reminder = dataStore.getAllStatusReminders().find(r => r.id === reminderId);
    if (!reminder) return undefined;

    const change = dataStore.getChange(reminder.changeId);
    if (!change) return undefined;

    const rules = dataStore.getReminderRules();
    const result = this.resolveStage(change, rules);
    if (!result) {
      return this.invalidateReminder(reminderId, '洽商状态已变更或不满足超期条件');
    }

    return dataStore.updateStatusReminder(reminderId, {
      overdueDays: result.overdueDays,
      dueDate: result.dueDate,
    });
  }

  formatReminderMessage(reminder: StatusReminder): string {
    const statusText = statusLabels[reminder.currentStatus];
    const categoryText = categoryLabels[reminder.category];
    const stageText = stageLabels[reminder.stage];

    return `【变更洽商超期提醒】
项目名称：${reminder.projectName}
洽商编号：${reminder.changeCode}
洽商标题：${reminder.changeTitle}
变更类型：${categoryText}
当前状态：${statusText}
当前阶段：${stageText}
阶段起始：${reminder.stageStartDate}
应完成日期：${reminder.dueDate}
已超期：${reminder.overdueDays} 天
请项目负责人 ${reminder.recipient} 尽快跟进处理。
——工程管理部智能提醒中心`;
  }

  formatReminderDigest(reminders: StatusReminder[]): string {
    if (reminders.length === 0) return '暂无超期待办，所有洽商进度良好。';

    const byProject: Record<string, StatusReminder[]> = {};
    for (const r of reminders) {
      if (!byProject[r.projectId]) byProject[r.projectId] = [];
      byProject[r.projectId].push(r);
    }

    let message = `【变更洽商超期待办摘要】共 ${reminders.length} 条超期记录，涉及 ${Object.keys(byProject).length} 个项目。\n\n`;

    for (const [projectId, projectReminders] of Object.entries(byProject)) {
      const projectName = projectReminders[0].projectName;
      const overdueSum = projectReminders.reduce((s, r) => s + r.overdueDays, 0);
      message += `📌 ${projectName}（${projectReminders.length}条，累计${overdueSum}天）\n`;
      projectReminders
        .sort((a, b) => b.overdueDays - a.overdueDays)
        .forEach((r, i) => {
          const stageText = stageLabels[r.stage];
          message += `  ${i + 1}. ${r.changeCode} - ${r.changeTitle} | 阶段：${stageText} | 超期${r.overdueDays}天\n`;
        });
      message += '\n';
    }

    message += '请各项目负责人尽快核实处理，确保资料及时闭合，避免影响后续签证和结算。';
    return message;
  }
}

export const statusReminderService = new StatusReminderService();
