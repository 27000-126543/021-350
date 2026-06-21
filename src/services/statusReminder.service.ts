import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import { StatusReminder, ChangeNegotiation, Project, ChangeStatus, categoryLabels, statusLabels } from '../types';

export class StatusReminderService {
  async checkAndGenerateReminders(): Promise<StatusReminder[]> {
    const rules = dataStore.getReminderRules();
    const allChanges = dataStore.getAllChanges();
    const reminders: StatusReminder[] = [];
    const existingReminderKeys = new Set(
      dataStore.getAllStatusReminders().map(r => `${r.changeId}-${r.currentStatus}`)
    );

    for (const change of allChanges) {
      if (change.status === 'closed' || change.status === 'rejected') {
        continue;
      }

      const { isOverdue, overdueDays, dueDate } = this.calculateOverdue(change, rules);

      if (isOverdue && overdueDays > 0) {
        const reminderKey = `${change.id}-${change.status}`;
        if (existingReminderKeys.has(reminderKey)) {
          continue;
        }

        const project = dataStore.getProject(change.projectId);
        if (!project) continue;

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
          registeredDate: change.registeredDate,
          dueDate,
          recipient: project.projectManager,
          recipientPhone: project.projectManagerPhone,
          createdAt: dayjs().toISOString(),
        };

        dataStore.addStatusReminder(reminder);
        reminders.push(reminder);
      }
    }

    return reminders;
  }

  private calculateOverdue(
    change: ChangeNegotiation,
    rules: { supervisorReviewDays: number; designReviewDays: number }
  ): { isOverdue: boolean; overdueDays: number; dueDate: string } {
    const now = dayjs();
    const registeredDate = dayjs(change.registeredDate);

    let reviewDays: number;
    let baseDate: dayjs.Dayjs;

    switch (change.status) {
      case 'registered':
        reviewDays = rules.supervisorReviewDays;
        baseDate = registeredDate;
        break;
      case 'supervisor_review':
        reviewDays = rules.designReviewDays;
        baseDate = change.supervisorOpinionDate
          ? dayjs(change.supervisorOpinionDate)
          : registeredDate.add(rules.supervisorReviewDays, 'day');
        break;
      case 'design_review':
        return { isOverdue: false, overdueDays: 0, dueDate: '' };
      default:
        return { isOverdue: false, overdueDays: 0, dueDate: '' };
    }

    const dueDate = baseDate.add(reviewDays, 'day');
    const overdueDays = now.diff(dueDate, 'day');

    return {
      isOverdue: overdueDays > 0,
      overdueDays: Math.max(0, overdueDays),
      dueDate: dueDate.format('YYYY-MM-DD'),
    };
  }

  getRemindersByProject(projectId: string): StatusReminder[] {
    return dataStore.getStatusRemindersByProject(projectId);
  }

  getAllReminders(): StatusReminder[] {
    return dataStore.getAllStatusReminders();
  }

  getOverdueChanges(projectId?: string): ChangeNegotiation[] {
    const rules = dataStore.getReminderRules();
    const changes = projectId
      ? dataStore.getChangesByProject(projectId)
      : dataStore.getAllChanges();

    return changes.filter(change => {
      if (change.status === 'closed' || change.status === 'rejected') return false;
      const { isOverdue } = this.calculateOverdue(change, rules);
      return isOverdue;
    });
  }

  formatReminderMessage(reminder: StatusReminder): string {
    const statusText = statusLabels[reminder.currentStatus];
    const categoryText = categoryLabels[reminder.category];

    return `【变更洽商超期提醒】
项目名称：${reminder.projectName}
洽商编号：${reminder.changeCode}
洽商标题：${reminder.changeTitle}
变更类型：${categoryText}
当前状态：${statusText}
登记日期：${reminder.registeredDate}
应完成日期：${reminder.dueDate}
已超期：${reminder.overdueDays} 天
请项目负责人 ${reminder.recipient} 尽快跟进处理。`;
  }

  formatReminderDigest(reminders: StatusReminder[]): string {
    if (reminders.length === 0) return '暂无超期待办。';

    const byProject: Record<string, StatusReminder[]> = {};
    for (const r of reminders) {
      if (!byProject[r.projectId]) byProject[r.projectId] = [];
      byProject[r.projectId].push(r);
    }

    let message = `【变更洽商超期待办摘要】共 ${reminders.length} 条超期记录，涉及 ${Object.keys(byProject).length} 个项目。\n\n`;

    for (const [projectId, projectReminders] of Object.entries(byProject)) {
      const projectName = projectReminders[0].projectName;
      message += `📌 ${projectName}（${projectReminders.length}条）\n`;
      projectReminders.forEach((r, i) => {
        message += `  ${i + 1}. ${r.changeCode} - ${r.changeTitle}，超期${r.overdueDays}天\n`;
      });
      message += '\n';
    }

    message += '请各项目负责人尽快核实处理，确保资料及时闭合。';
    return message;
  }
}

export const statusReminderService = new StatusReminderService();
