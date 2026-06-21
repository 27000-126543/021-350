import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  ReminderHandlingStatus,
  ReminderHandlingRecord,
  ProjectReminderBoard,
  handlingStatusLabels,
} from '../types';

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
    handlingNote?: string,
    handlingAttachments?: string[]
  ): { success: boolean; message: string; record?: ReminderHandlingRecord } {
    return this.updateHandling(reminderType, reminderId, 'handled', handledBy, handlingNote, handlingAttachments);
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

  getBoard(projectId?: string): ProjectReminderBoard[] {
    return dataStore.buildReminderBoard(projectId);
  }

  getHandlingRecords(reminderType?: 'status_overdue' | 'risk_alert', reminderId?: string, projectId?: string): ReminderHandlingRecord[] {
    if (reminderId && reminderType) {
      return dataStore.getHandlingRecordsByReminder(reminderId);
    }
    if (projectId) {
      let records = dataStore.getHandlingRecordsByProject(projectId);
      if (reminderType) records = records.filter(r => r.reminderType === reminderType);
      return records;
    }
    return [];
  }

  getHandlingDeadline(): dayjs.Dayjs {
    const rules = dataStore.getReminderRules();
    return dayjs().add(rules.reminderHandlingDeadlineDays, 'day');
  }
}

export const reminderHandlingService = new ReminderHandlingService();
