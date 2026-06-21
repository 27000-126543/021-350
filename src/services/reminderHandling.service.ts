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
} from '../types';

type BoardKey = 'unread' | 'read' | 'inProgress' | 'handled' | 'overdueUnhandled';

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
    handlingAttachments?: string[]
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    return this.updateHandling(reminderType, reminderId, 'in_progress', handledBy, handlingNote, handlingAttachments);
  }

  markAsHandled(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string,
    handledBy: string,
    handlingNote: string,
    handlingAttachments?: string[]
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    if (!handlingNote || !handlingNote.trim()) {
      return {
        success: false,
        message: '标记已处理必须填写处理说明（handlingNote），请补充处置措施、结果等说明后再提交',
      };
    }
    if (handlingAttachments && !Array.isArray(handlingAttachments)) {
      return {
        success: false,
        message: '附件链接必须是字符串数组，每个元素为一个独立的附件URL',
      };
    }
    if (handlingAttachments) {
      for (const url of handlingAttachments) {
        if (typeof url !== 'string' || url.length < 4) {
          return { success: false, message: `附件链接格式异常: ${url}` };
        }
      }
    }
    return this.updateHandling(reminderType, reminderId, 'handled', handledBy, handlingNote.trim(), handlingAttachments);
  }

  updateHandling(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string,
    status: ReminderHandlingStatus,
    handledBy: string,
    handlingNote?: string,
    handlingAttachments?: string[]
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    const { reminder, record } = dataStore.updateReminderHandling(
      reminderType,
      reminderId,
      status,
      handledBy,
      handlingNote,
      handlingAttachments
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

  getHandlingDeadline(): dayjs.Dayjs {
    const rules = dataStore.getReminderRules();
    return dayjs().add(rules.reminderHandlingDeadlineDays, 'day');
  }
}

export const reminderHandlingService = new ReminderHandlingService();
