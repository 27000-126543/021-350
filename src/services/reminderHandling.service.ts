import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  ReminderHandlingStatus,
  ReminderHandlingRecord,
  ProjectReminderBoard,
  handlingStatusLabels,
  HandlingRecordFilter,
  BoardFilter,
  OverdueRankItem,
  RecentHandlingActivity,
  ReminderFullFlow,
  ReminderBoardItem,
  HandlingAttachment,
  ManagerDashboard,
  ManagerProjectItem,
  ManagerReminderItem,
  ClosureListExport,
  ClosureListItem,
  ReminderStage,
  StatusReminder,
  RiskAlert,
} from '../types';

type BoardKey = 'unread' | 'read' | 'inProgress' | 'handled' | 'overdueUnhandled';

function normalizeAttachments(
  input: (string | HandlingAttachment)[] | undefined,
  handledBy: string
): HandlingAttachment[] | undefined {
  if (!input || !Array.isArray(input)) return undefined;
  return input.map(item => {
    if (typeof item === 'string') {
      const parts = item.split('/');
      const name = parts[parts.length - 1] || item;
      return { name, url: item, uploadedBy: handledBy, uploadedAt: dayjs().toISOString() };
    }
    return item;
  });
}

function validateAttachments(attachments: any[]): { valid: boolean; message?: string } {
  for (const item of attachments) {
    if (typeof item === 'string') {
      if (item.length < 4) return { valid: false, message: `附件链接格式异常: ${item}` };
    } else if (typeof item === 'object' && item !== null) {
      if (!item.url || typeof item.url !== 'string' || item.url.length < 4) {
        return { valid: false, message: `附件缺少有效url字段` };
      }
    } else {
      return { valid: false, message: `附件格式不支持: ${JSON.stringify(item)}` };
    }
  }
  return { valid: true };
}

export class ReminderHandlingService {
  markAsRead(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string,
    handledBy: string
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    return this.updateHandling(reminderType, reminderId, 'read', handledBy);
  }

  markInProgress(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string,
    handledBy: string,
    handlingNote?: string,
    handlingAttachments?: (string | HandlingAttachment)[]
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    const normalized = normalizeAttachments(handlingAttachments, handledBy);
    return this.updateHandling(reminderType, reminderId, 'in_progress', handledBy, handlingNote, normalized as any);
  }

  markAsHandled(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string,
    handledBy: string,
    handlingNote: string,
    handlingAttachments?: (string | HandlingAttachment)[]
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    if (!handlingNote || !handlingNote.trim()) {
      return {
        success: false,
        message: '标记已处理必须填写处理说明（handlingNote），请补充处置措施、结果等说明后再提交',
      };
    }
    if (handlingAttachments && Array.isArray(handlingAttachments)) {
      const v = validateAttachments(handlingAttachments);
      if (!v.valid) return { success: false, message: v.message! };
    }
    const normalized = normalizeAttachments(handlingAttachments, handledBy);
    return this.updateHandling(reminderType, reminderId, 'handled', handledBy, handlingNote.trim(), normalized as any);
  }

  updateHandling(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string,
    status: ReminderHandlingStatus,
    handledBy: string,
    handlingNote?: string,
    handlingAttachments?: (string | HandlingAttachment)[]
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    if (status === 'handled' && (!handlingNote || !handlingNote.trim())) {
      return {
        success: false,
        message: '标记已处理必须填写处理说明（handlingNote），无论从哪个入口提交都必须填写',
      };
    }

    const normalized = normalizeAttachments(handlingAttachments, handledBy);
    const { reminder, record } = dataStore.updateReminderHandling(
      reminderType,
      reminderId,
      status,
      handledBy,
      handlingNote?.trim(),
      normalized as any
    );
    if (!reminder) {
      return { success: false, message: `未找到${reminderType === 'status_overdue' ? '状态提醒' : '风险提示'}：${reminderId}` };
    }
    return {
      success: true,
      message: `已标记为${handlingStatusLabels[status]}（操作人：${handledBy}）`,
      record,
    };
  }

  refreshOverdueStatus(): { updated: number; message: string } {
    const updated = dataStore.refreshOverdueHandlingStatus();
    return {
      updated,
      message: updated > 0 ? `已将 ${updated} 条超过处置期限的提醒标记为「超时未处理」` : '当前没有超过处置期限的提醒',
    };
  }

  getBoard(filter: BoardFilter = {}): ProjectReminderBoard[] {
    const boards = dataStore.buildReminderBoard(filter.projectId);
    let result = boards;

    if (filter.projectManagerId) {
      const validProjectIds = new Set(
        Array.from(dataStore.getAllProjects())
          .filter(p => (p.projectManagerId || p.projectManager) === filter.projectManagerId)
          .map(p => p.id)
      );
      result = result.filter(b => validProjectIds.has(b.projectId));
    }

    for (const b of result) {
      if (!b.read) b.read = [];
      const bucketMap: Record<string, ReminderBoardItem[]> = {
        unread: b.unread || [],
        read: b.read,
        inProgress: b.inProgress || [],
        handled: b.handled || [],
        overdueUnhandled: b.overdueUnhandled || [],
      };

      for (const key of Object.keys(bucketMap) as BoardKey[]) {
        let list = bucketMap[key];
        if (filter.reminderType) {
          list = list.filter(i => i.reminderType === filter.reminderType);
        }
        if (filter.deadlineFrom || filter.deadlineTo) {
          list = list.filter(i => {
            const dl = i.handlingDeadline;
            if (!dl) return false;
            if (filter.deadlineFrom && dl < filter.deadlineFrom) return false;
            if (filter.deadlineTo && dl > filter.deadlineTo) return false;
            return true;
          });
        }
        bucketMap[key] = list;
      }

      b.unread = bucketMap.unread;
      b.read = bucketMap.read;
      b.inProgress = bucketMap.inProgress;
      b.handled = bucketMap.handled;
      b.overdueUnhandled = bucketMap.overdueUnhandled;
      b.in_progress = b.inProgress;
      b.overdue = b.overdueUnhandled;

      const summary = {
        total: b.unread.length + b.read.length + b.inProgress.length + b.handled.length + b.overdueUnhandled.length,
        unreadCount: b.unread.length,
        inProgressCount: b.inProgress.length,
        handledCount: b.handled.length,
        overdueUnhandledCount: b.overdueUnhandled.length,
        unread: b.unread.length,
        read: b.read.length,
        inProgress: b.inProgress.length,
        handled: b.handled.length,
        overdueUnhandled: b.overdueUnhandled.length,
      };
      b.summary = summary;
    }

    return result;
  }

  getManagerDashboard(managerId: string): ManagerDashboard {
    const projects = Array.from(dataStore.getAllProjects())
      .filter(p => (p.projectManagerId || p.projectManager) === managerId);
    const managerName = projects[0]?.projectManagerName || projects[0]?.projectManager || managerId;
    const now = dayjs();
    const sevenDaysAgo = now.subtract(7, 'day');

    const projectItems: ManagerProjectItem[] = projects.map(p => {
      const statusReminders: any[] = Array.from((dataStore as any).statusReminders?.values?.() || [])
        .filter((r: any) => r.projectId === p.id) as any[];
      const riskAlerts: any[] = Array.from((dataStore as any).riskAlerts?.values?.() || [])
        .filter((r: any) => r.projectId === p.id) as any[];
      const allReminders = [...statusReminders, ...riskAlerts];

      const pending = allReminders.filter((r: any) => ['unread', 'read', 'in_progress'].includes(r.handlingStatus));
      const overdue = allReminders.filter((r: any) => r.handlingStatus === 'overdue_unhandled');
      const handled7d = allReminders.filter((r: any) =>
        r.handlingStatus === 'handled' && r.handledAt && dayjs(r.handledAt).isAfter(sevenDaysAgo)
      );
      const total7d = allReminders.filter((r: any) =>
        r.createdAt && dayjs(r.createdAt).isAfter(sevenDaysAgo)
      );

      const changes = Array.from((dataStore as any).changes?.values?.() || [])
        .filter((c: any) => c.projectId === p.id && c.status !== 'closed' && c.status !== 'rejected') as any[];
      const unclosedAmount = changes.reduce((s: number, c: any) => s + (c.estimatedAmount || 0), 0);

      const reminderItems: ManagerReminderItem[] = allReminders.map((r: any) => ({
        reminderId: r.id,
        reminderType: r.type,
        title: r.title || r.changeTitle || `${r.projectName}`,
        handlingStatus: r.handlingStatus,
        overdueDays: r.handlingDeadline ? Math.max(0, now.diff(dayjs(r.handlingDeadline), 'day')) : undefined,
        handlingDeadline: r.handlingDeadline,
        estimatedAmount: r.totalEstimatedAmount || r.estimatedAmount,
        createdAt: r.createdAt,
        handledAt: r.handledAt,
        handlingNote: r.handlingNote,
        handlingAttachments: r.handlingAttachments,
      }));

      const latestHandling = allReminders
        .filter((r: any) => r.handledAt)
        .sort((a: any, b: any) => dayjs(b.handledAt).valueOf() - dayjs(a.handledAt).valueOf())[0];

      return {
        projectId: p.id,
        projectName: p.name,
        pendingCount: pending.length,
        overdueCount: overdue.length,
        handledIn7Days: handled7d.length,
        unclosedAmount,
        latestHandlingAt: latestHandling?.handledAt,
        reminders: reminderItems,
      };
    });

    const totalPending = projectItems.reduce((s, p) => s + p.pendingCount, 0);
    const totalOverdue = projectItems.reduce((s, p) => s + p.overdueCount, 0);
    const totalHandled7d = projectItems.reduce((s, p) => s + p.handledIn7Days, 0);
    const total7d = projectItems.reduce((s, p) => {
      const proj = projects.find(pr => pr.id === p.projectId);
      return s + (proj ? p.handledIn7Days + p.pendingCount : 0);
    }, 0);
    const totalUnclosed = projectItems.reduce((s, p) => s + p.unclosedAmount, 0);

    return {
      managerId,
      managerName,
      projectCount: projects.length,
      pendingCount: totalPending,
      overdueCount: totalOverdue,
      handledIn7Days: totalHandled7d,
      totalIn7Days: total7d,
      handlingEfficiency7d: total7d > 0 ? Math.round((totalHandled7d / total7d) * 1000) / 10 : 0,
      unclosedAmount: totalUnclosed,
      projects: projectItems,
    };
  }

  getHandlingRecords(filter: HandlingRecordFilter = {}): ReminderHandlingRecord[] {
    return dataStore.getHandlingRecordsByFilter(filter);
  }

  getOverdueRank(limit: number = 10): OverdueRankItem[] {
    return dataStore.getOverdueRank(limit);
  }

  getRecentActivities(limit: number = 20): RecentHandlingActivity[] {
    return dataStore.getRecentHandlingActivities(limit);
  }

  getReminderFullFlow(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string
  ): { success: boolean; message?: string; flow?: ReminderFullFlow } {
    const flow = dataStore.getReminderFullFlow(reminderType, reminderId);
    if (!flow) {
      return { success: false, message: `未找到对应的提醒记录[类型=${reminderType}, ID=${reminderId}]` };
    }
    return { success: true, flow };
  }

  exportClosureList(filter: {
    projectId?: string;
    reminderType?: 'status_overdue' | 'risk_alert';
    handlingStatus?: ReminderHandlingStatus;
    dateFrom?: string;
    dateTo?: string;
  }): ClosureListExport {
    const statusReminders: StatusReminder[] = Array.from((dataStore as any).statusReminders?.values?.() || []) as StatusReminder[];
    const riskAlerts: RiskAlert[] = Array.from((dataStore as any).riskAlerts?.values?.() || []) as RiskAlert[];

    const allItems: any[] = [...statusReminders, ...riskAlerts];
    let filtered = allItems;

    if (filter.projectId) filtered = filtered.filter(r => r.projectId === filter.projectId);
    if (filter.reminderType) filtered = filtered.filter(r => r.type === filter.reminderType);
    if (filter.handlingStatus) filtered = filtered.filter(r => r.handlingStatus === filter.handlingStatus);
    if (filter.dateFrom) filtered = filtered.filter(r => r.createdAt >= filter.dateFrom!);
    if (filter.dateTo) filtered = filtered.filter(r => r.createdAt <= filter.dateTo! + 'T23:59:59');

    const items: ClosureListItem[] = filtered.map(r => {
      const dur = r.handledAt && r.createdAt
        ? Math.round(dayjs(r.handledAt).diff(dayjs(r.createdAt), 'day', true) * 10) / 10
        : undefined;
      const overdue = r.handlingDeadline
        ? Math.max(0, dayjs().diff(dayjs(r.handlingDeadline), 'day'))
        : undefined;
      const change = (r as any).changeId
        ? Array.from((dataStore as any).changes?.values?.() || []).find((c: any) => c.id === (r as any).changeId)
        : null;

      return {
        reminderId: r.id,
        reminderType: r.type,
        projectId: r.projectId,
        projectName: r.projectName,
        title: (r as any).title || (r as any).changeTitle || '',
        handlingStatus: r.handlingStatus,
        createdAt: r.createdAt,
        handledAt: r.handledAt,
        handlingDeadline: r.handlingDeadline,
        handlingDurationDays: dur,
        overdueDays: r.handlingStatus === 'overdue_unhandled' ? overdue : undefined,
        handledBy: r.handledBy,
        handlingNote: r.handlingNote,
        handlingAttachments: r.handlingAttachments as any,
        estimatedAmount: (r as any).totalEstimatedAmount || (r as any).estimatedAmount || (change as any)?.estimatedAmount,
        stage: (r as any).stage as ReminderStage | undefined,
      };
    });

    const handled = items.filter(i => i.handlingStatus === 'handled');
    const overdueItems = items.filter(i => i.handlingStatus === 'overdue_unhandled');
    const avgDays = handled.length > 0
      ? Math.round(handled.reduce((s, i) => s + (i.handlingDurationDays || 0), 0) / handled.length * 10) / 10
      : 0;
    const unclosedAmount = items
      .filter(i => i.handlingStatus !== 'handled')
      .reduce((s, i) => s + (i.estimatedAmount || 0), 0);

    const filterDesc = [
      filter.projectId ? `项目=${filter.projectId}` : '',
      filter.reminderType ? `类型=${filter.reminderType}` : '',
      filter.handlingStatus ? `状态=${handlingStatusLabels[filter.handlingStatus]}` : '',
      filter.dateFrom ? `起始=${filter.dateFrom}` : '',
      filter.dateTo ? `截止=${filter.dateTo}` : '',
    ].filter(Boolean).join('、') || '全部';

    return {
      exportTime: dayjs().toISOString(),
      filterDescription: filterDesc,
      totalCount: items.length,
      items,
      summary: {
        totalHandled: handled.length,
        totalOverdue: overdueItems.length,
        avgHandlingDays: avgDays,
        totalUnclosedAmount: unclosedAmount,
      },
    };
  }

  getHandlingDeadline(): dayjs.Dayjs {
    const rules = dataStore.getReminderRules();
    return dayjs().add(rules.reminderHandlingDeadlineDays, 'day');
  }
}

export const reminderHandlingService = new ReminderHandlingService();
