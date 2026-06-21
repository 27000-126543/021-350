import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import {
  Project,
  ChangeNegotiation,
  StatusReminder,
  RiskAlert,
  WeeklySummary,
  ReminderRules,
  defaultReminderRules,
  ComprehensiveRiskView,
  PushRecord,
  ReminderRulesLog,
  ChangeStatus,
} from '../types';

class DataStore {
  private projects: Map<string, Project> = new Map();
  private changes: Map<string, ChangeNegotiation> = new Map();
  private statusReminders: Map<string, StatusReminder> = new Map();
  private riskAlerts: Map<string, RiskAlert> = new Map();
  private comprehensiveRiskViews: Map<string, ComprehensiveRiskView> = new Map();
  private weeklySummaries: Map<string, WeeklySummary> = new Map();
  private reminderRules: ReminderRules = { ...defaultReminderRules };
  private reminderRulesLogs: Map<string, ReminderRulesLog> = new Map();
  private pushRecords: Map<string, PushRecord> = new Map();

  generateId(): string {
    return uuidv4();
  }

  addProject(project: Project): Project {
    this.projects.set(project.id, project);
    return project;
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  getAllProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  addChange(change: ChangeNegotiation): ChangeNegotiation {
    this.changes.set(change.id, change);
    return change;
  }

  getChange(id: string): ChangeNegotiation | undefined {
    return this.changes.get(id);
  }

  getAllChanges(): ChangeNegotiation[] {
    return Array.from(this.changes.values());
  }

  getChangesByProject(projectId: string): ChangeNegotiation[] {
    return Array.from(this.changes.values()).filter(c => c.projectId === projectId);
  }

  updateChange(id: string, updates: Partial<ChangeNegotiation>): ChangeNegotiation | undefined {
    const change = this.changes.get(id);
    if (!change) return undefined;
    const updated = { ...change, ...updates };
    this.changes.set(id, updated);
    return updated;
  }

  addStatusReminder(reminder: StatusReminder): StatusReminder {
    this.statusReminders.set(reminder.id, reminder);
    return reminder;
  }

  getStatusRemindersByProject(projectId: string, onlyActive: boolean = false): StatusReminder[] {
    return Array.from(this.statusReminders.values()).filter(r => {
      if (r.projectId !== projectId) return false;
      if (onlyActive && !r.isActive) return false;
      return true;
    });
  }

  getAllStatusReminders(onlyActive: boolean = false): StatusReminder[] {
    const all = Array.from(this.statusReminders.values());
    return onlyActive ? all.filter(r => r.isActive) : all;
  }

  getStatusReminderByChangeAndStage(changeId: string, stage: string): StatusReminder | undefined {
    return Array.from(this.statusReminders.values()).find(
      r => r.changeId === changeId && r.stage === stage
    );
  }

  invalidateRemindersForChange(changeId: string, newStatus: ChangeStatus): StatusReminder[] {
    const invalidated: StatusReminder[] = [];
    const now = dayjs().toISOString();

    for (const reminder of this.statusReminders.values()) {
      if (reminder.changeId !== changeId || !reminder.isActive) continue;

      let shouldInvalidate = false;
      let reason = '';

      if (newStatus === 'closed' || newStatus === 'rejected') {
        shouldInvalidate = true;
        reason = `洽商已${newStatus === 'closed' ? '闭合' : '驳回'}`;
      } else if (newStatus === 'supervisor_review' && reminder.stage === 'registered_to_supervisor') {
        shouldInvalidate = true;
        reason = '已取得监理意见，进入下一阶段';
      } else if (newStatus === 'design_review' && (reminder.stage === 'registered_to_supervisor' || reminder.stage === 'supervisor_to_design')) {
        shouldInvalidate = true;
        reason = '已取得设计意见或状态推进';
      }

      if (shouldInvalidate) {
        const updated: StatusReminder = {
          ...reminder,
          isActive: false,
          invalidatedAt: now,
          invalidatedReason: reason,
          lastUpdatedAt: now,
        };
        this.statusReminders.set(reminder.id, updated);
        invalidated.push(updated);
      }
    }

    return invalidated;
  }

  updateStatusReminder(id: string, updates: Partial<StatusReminder>): StatusReminder | undefined {
    const reminder = this.statusReminders.get(id);
    if (!reminder) return undefined;
    const updated = { ...reminder, ...updates, lastUpdatedAt: dayjs().toISOString() };
    this.statusReminders.set(id, updated);
    return updated;
  }

  addRiskAlert(alert: RiskAlert): RiskAlert {
    this.riskAlerts.set(alert.id, alert);
    return alert;
  }

  getRiskAlertsByProject(projectId: string): RiskAlert[] {
    return Array.from(this.riskAlerts.values()).filter(a => a.projectId === projectId);
  }

  getAllRiskAlerts(): RiskAlert[] {
    return Array.from(this.riskAlerts.values());
  }

  getRiskAlertByKey(projectId: string, professional: string, category: string): RiskAlert | undefined {
    return Array.from(this.riskAlerts.values()).find(
      a => a.projectId === projectId && a.professional === professional && a.category === category
    );
  }

  updateRiskAlert(id: string, updates: Partial<RiskAlert>): RiskAlert | undefined {
    const alert = this.riskAlerts.get(id);
    if (!alert) return undefined;
    const updated = { ...alert, ...updates };
    this.riskAlerts.set(id, updated);
    return updated;
  }

  saveComprehensiveRiskView(view: ComprehensiveRiskView): ComprehensiveRiskView {
    const key = `${view.projectId}::${view.professional}`;
    const existing = Array.from(this.comprehensiveRiskViews.values()).find(
      v => v.projectId === view.projectId && v.professional === view.professional
    );
    if (existing) {
      this.comprehensiveRiskViews.delete(existing.id);
    }
    this.comprehensiveRiskViews.set(view.id, view);
    return view;
  }

  getComprehensiveRiskViews(projectId?: string): ComprehensiveRiskView[] {
    let views = Array.from(this.comprehensiveRiskViews.values());
    if (projectId) {
      views = views.filter(v => v.projectId === projectId);
    }
    return views.sort((a, b) => {
      const levelOrder = { high: 0, medium: 1, low: 2 };
      return levelOrder[a.overallRiskLevel] - levelOrder[b.overallRiskLevel];
    });
  }

  getComprehensiveRiskViewById(id: string): ComprehensiveRiskView | undefined {
    return this.comprehensiveRiskViews.get(id);
  }

  addWeeklySummary(summary: WeeklySummary): WeeklySummary {
    this.weeklySummaries.set(summary.id, summary);
    return summary;
  }

  getLatestWeeklySummary(): WeeklySummary | undefined {
    const summaries = Array.from(this.weeklySummaries.values());
    if (summaries.length === 0) return undefined;
    return summaries.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
  }

  getWeeklySummariesByWeek(weekStart: string, weekEnd: string): WeeklySummary | undefined {
    return Array.from(this.weeklySummaries.values()).find(
      s => s.weekStart === weekStart && s.weekEnd === weekEnd
    );
  }

  getAllWeeklySummaries(): WeeklySummary[] {
    return Array.from(this.weeklySummaries.values()).sort(
      (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
  }

  getReminderRules(): ReminderRules {
    return { ...this.reminderRules };
  }

  updateReminderRules(
    rules: Partial<ReminderRules>,
    changedBy: string = 'system',
    description: string = ''
  ): { rules: ReminderRules; log: ReminderRulesLog } {
    const previousRules = { ...this.reminderRules };
    const changedFields: Partial<ReminderRules> = {};

    for (const key of Object.keys(rules) as (keyof ReminderRules)[]) {
      if (rules[key] !== undefined && rules[key] !== previousRules[key]) {
        (changedFields as any)[key] = rules[key];
      }
    }

    this.reminderRules = { ...this.reminderRules, ...rules };

    const log: ReminderRulesLog = {
      id: this.generateId(),
      changedBy,
      previousRules: changedFields,
      newRules: changedFields,
      changedAt: dayjs().toISOString(),
      description: description || `修改了 ${Object.keys(changedFields).length} 项规则配置`,
    };
    this.reminderRulesLogs.set(log.id, log);

    return {
      rules: { ...this.reminderRules },
      log,
    };
  }

  getReminderRulesLogs(): ReminderRulesLog[] {
    return Array.from(this.reminderRulesLogs.values()).sort(
      (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
    );
  }

  addPushRecord(record: PushRecord): PushRecord {
    this.pushRecords.set(record.id, record);
    return record;
  }

  getPushRecords(params?: {
    reminderType?: string;
    channel?: string;
    result?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }): { records: PushRecord[]; total: number } {
    let records = Array.from(this.pushRecords.values());

    if (params?.reminderType) {
      records = records.filter(r => r.reminderType === params.reminderType);
    }
    if (params?.channel) {
      records = records.filter(r => r.channel === params.channel);
    }
    if (params?.result) {
      records = records.filter(r => r.result === params.result);
    }
    if (params?.fromDate) {
      records = records.filter(r => dayjs(r.generatedAt).isAfter(dayjs(params.fromDate).startOf('day')));
    }
    if (params?.toDate) {
      records = records.filter(r => dayjs(r.generatedAt).isBefore(dayjs(params.toDate).endOf('day')));
    }

    records.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

    const total = records.length;

    if (params?.page && params?.pageSize) {
      const start = (params.page - 1) * params.pageSize;
      records = records.slice(start, start + params.pageSize);
    }

    return { records, total };
  }

  getPushRecordById(id: string): PushRecord | undefined {
    return this.pushRecords.get(id);
  }

  getPushRecordsByReminder(reminderType: string, reminderId: string): PushRecord[] {
    return Array.from(this.pushRecords.values())
      .filter(r => r.reminderType === reminderType && r.reminderId === reminderId)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }

  updatePushRecord(id: string, updates: Partial<PushRecord>): PushRecord | undefined {
    const record = this.pushRecords.get(id);
    if (!record) return undefined;
    const updated = { ...record, ...updates };
    this.pushRecords.set(id, updated);
    return updated;
  }

  getPushStatistics(fromDate?: string, toDate?: string) {
    let records = Array.from(this.pushRecords.values());
    if (fromDate) {
      records = records.filter(r => dayjs(r.generatedAt).isAfter(dayjs(fromDate).startOf('day')));
    }
    if (toDate) {
      records = records.filter(r => dayjs(r.generatedAt).isBefore(dayjs(toDate).endOf('day')));
    }

    const typeStats: Record<string, number> = {};
    const channelStats: Record<string, number> = {};
    const resultStats: Record<string, number> = {};

    for (const r of records) {
      typeStats[r.reminderType] = (typeStats[r.reminderType] || 0) + 1;
      channelStats[r.channel] = (channelStats[r.channel] || 0) + 1;
      resultStats[r.result] = (resultStats[r.result] || 0) + 1;
    }

    return {
      total: records.length,
      byType: typeStats,
      byChannel: channelStats,
      byResult: resultStats,
    };
  }

  clearAll(): void {
    this.projects.clear();
    this.changes.clear();
    this.statusReminders.clear();
    this.riskAlerts.clear();
    this.comprehensiveRiskViews.clear();
    this.weeklySummaries.clear();
    this.reminderRulesLogs.clear();
    this.pushRecords.clear();
    this.reminderRules = { ...defaultReminderRules };
  }
}

export const dataStore = new DataStore();
