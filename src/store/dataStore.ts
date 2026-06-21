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
  ReminderHandlingStatus,
  ReminderHandlingRecord,
  ProjectReminderBoard,
  ReminderBoardItem,
  handlingStatusLabels,
  HandlingRecordFilter,
  OverdueRankItem,
  RecentHandlingActivity,
  ReminderFullFlow,
  ReminderFlowStep,
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
  private reminderHandlingRecords: Map<string, ReminderHandlingRecord> = new Map();

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

  getPushRecordsByReminderGrouped(reminderType: string, reminderId: string) {
    const records = this.getPushRecordsByReminder(reminderType, reminderId);
    const grouped: Record<string, PushRecord[]> = {};
    for (const r of records) {
      if (!grouped[r.channel]) grouped[r.channel] = [];
      grouped[r.channel].push(r);
    }
    return grouped;
  }

  updatePushRecordChannelResult(
    reminderType: string,
    reminderId: string,
    channel: string,
    result: 'success' | 'failed',
    resultMessage?: string
  ): PushRecord[] | undefined {
    const updated: PushRecord[] = [];
    const now = dayjs().toISOString();
    for (const record of this.pushRecords.values()) {
      if (record.reminderType === reminderType && record.reminderId === reminderId && record.channel === channel) {
        const newRecord = {
          ...record,
          result,
          resultMessage,
          pushedAt: now,
        };
        this.pushRecords.set(record.id, newRecord);
        updated.push(newRecord);
      }
    }
    return updated.length > 0 ? updated : undefined;
  }

  addHandlingRecord(record: ReminderHandlingRecord): ReminderHandlingRecord {
    this.reminderHandlingRecords.set(record.id, record);
    return record;
  }

  getHandlingRecordsByReminder(reminderId: string): ReminderHandlingRecord[] {
    return Array.from(this.reminderHandlingRecords.values())
      .filter(r => r.reminderId === reminderId)
      .sort((a, b) => new Date(b.handledAt).getTime() - new Date(a.handledAt).getTime());
  }

  getHandlingRecordsByProject(projectId: string): ReminderHandlingRecord[] {
    return Array.from(this.reminderHandlingRecords.values())
      .filter(r => r.projectId === projectId)
      .sort((a, b) => new Date(b.handledAt).getTime() - new Date(a.handledAt).getTime());
  }

  getStatusReminder(id: string): StatusReminder | undefined {
    return this.statusReminders.get(id);
  }

  getRiskAlert(id: string): RiskAlert | undefined {
    return this.riskAlerts.get(id);
  }

  updateReminderHandling(
    reminderType: 'status_overdue' | 'risk_alert',
    reminderId: string,
    status: ReminderHandlingStatus,
    handledBy: string,
    handlingNote?: string,
    handlingAttachments?: string[]
  ): { reminder: StatusReminder | RiskAlert | undefined; record: ReminderHandlingRecord } {
    const now = dayjs().toISOString();
    let reminder: StatusReminder | RiskAlert | undefined;
    let previousStatus: ReminderHandlingStatus = 'unread';

    if (reminderType === 'status_overdue') {
      reminder = this.statusReminders.get(reminderId);
      if (reminder) {
        previousStatus = reminder.handlingStatus;
        const updates: Partial<StatusReminder> = {
          handlingStatus: status,
          handledBy,
          handledAt: now,
          lastUpdatedAt: now,
        };
        if (handlingNote !== undefined) updates.handlingNote = handlingNote;
        if (handlingAttachments !== undefined) updates.handlingAttachments = handlingAttachments;
        reminder = { ...reminder, ...updates };
        this.statusReminders.set(reminderId, reminder as StatusReminder);
      }
    } else {
      reminder = this.riskAlerts.get(reminderId);
      if (reminder) {
        previousStatus = reminder.handlingStatus;
        const updates: Partial<RiskAlert> = {
          handlingStatus: status,
          handledBy,
          handledAt: now,
        };
        if (handlingNote !== undefined) updates.handlingNote = handlingNote;
        if (handlingAttachments !== undefined) updates.handlingAttachments = handlingAttachments;
        reminder = { ...reminder, ...updates };
        this.riskAlerts.set(reminderId, reminder as RiskAlert);
      }
    }

    const record: ReminderHandlingRecord = {
      id: this.generateId(),
      reminderId,
      reminderType,
      projectId: reminder?.projectId || '',
      projectName: reminder?.projectName || '',
      previousStatus,
      newStatus: status,
      handledBy,
      handledAt: now,
      handlingNote,
      handlingAttachments,
    };
    this.reminderHandlingRecords.set(record.id, record);

    return { reminder, record };
  }

  refreshOverdueHandlingStatus(): number {
    const now = dayjs();
    let updated = 0;
    for (const reminder of this.statusReminders.values()) {
      if (reminder.handlingDeadline && !['handled', 'overdue_unhandled'].includes(reminder.handlingStatus)) {
        if (now.isAfter(dayjs(reminder.handlingDeadline))) {
          this.statusReminders.set(reminder.id, {
            ...reminder,
            handlingStatus: 'overdue_unhandled',
            lastUpdatedAt: now.toISOString(),
          });
          updated++;
        }
      }
    }
    for (const alert of this.riskAlerts.values()) {
      if (alert.handlingDeadline && !['handled', 'overdue_unhandled'].includes(alert.handlingStatus)) {
        if (now.isAfter(dayjs(alert.handlingDeadline))) {
          this.riskAlerts.set(alert.id, {
            ...alert,
            handlingStatus: 'overdue_unhandled',
          });
          updated++;
        }
      }
    }
    return updated;
  }

  buildReminderBoard(projectId?: string): ProjectReminderBoard[] {
    const projects = projectId ? [this.getProject(projectId)].filter(Boolean) as Project[] : this.getAllProjects();
    const boards: ProjectReminderBoard[] = [];

    for (const p of projects) {
      const items: ReminderBoardItem[] = [];

      for (const r of this.getStatusRemindersByProject(p.id, true)) {
        items.push({
          reminderId: r.id,
          reminderType: 'status_overdue',
          projectId: r.projectId,
          projectName: r.projectName,
          title: `${r.changeCode} ${r.changeTitle}`,
          description: `超期${r.overdueDays}天 · ${handlingStatusLabels[r.handlingStatus]}`,
          stage: r.stage,
          overdueDays: r.overdueDays,
          handlingStatus: r.handlingStatus,
          recipient: r.recipient,
          createdAt: r.createdAt,
          handlingDeadline: r.handlingDeadline,
        });
      }

      for (const a of this.getRiskAlertsByProject(p.id)) {
        items.push({
          reminderId: a.id,
          reminderType: 'risk_alert',
          projectId: a.projectId,
          projectName: a.projectName,
          title: `风险提示·${a.professional}专业·${a.category}`,
          description: `近${a.timeWindowDays}天${a.changeCount}条 · ${handlingStatusLabels[a.handlingStatus]}`,
          riskLevel: a.riskLevel,
          handlingStatus: a.handlingStatus,
          recipient: p.projectManager,
          createdAt: a.createdAt,
          handlingDeadline: a.handlingDeadline,
        });
      }

      boards.push({
        projectId: p.id,
        projectName: p.name,
        unread: items.filter(i => i.handlingStatus === 'unread'),
        inProgress: items.filter(i => ['read', 'in_progress'].includes(i.handlingStatus)),
        handled: items.filter(i => i.handlingStatus === 'handled'),
        overdueUnhandled: items.filter(i => i.handlingStatus === 'overdue_unhandled'),
        summary: {
          total: items.length,
          unreadCount: items.filter(i => i.handlingStatus === 'unread').length,
          inProgressCount: items.filter(i => ['read', 'in_progress'].includes(i.handlingStatus)).length,
          handledCount: items.filter(i => i.handlingStatus === 'handled').length,
          overdueUnhandledCount: items.filter(i => i.handlingStatus === 'overdue_unhandled').length,
        },
      });
    }
    return boards;
  }

  getWeeklySummariesTrend(weeks: number = 8): WeeklySummary[] {
    return this.getAllWeeklySummaries().slice(0, weeks);
  }

  getHandlingRecordsByFilter(filter: HandlingRecordFilter = {}): ReminderHandlingRecord[] {
    let records = Array.from(this.reminderHandlingRecords.values());
    if (filter.reminderId) records = records.filter(r => r.reminderId === filter.reminderId);
    if (filter.reminderType) records = records.filter(r => r.reminderType === filter.reminderType);
    if (filter.projectId) records = records.filter(r => r.projectId === filter.projectId);
    if (filter.handledBy) records = records.filter(r => r.handledBy === filter.handledBy);
    if (filter.projectManagerId) {
      const validProjectIds = Array.from(this.projects.values())
        .filter(p => (p.projectManagerId || p.projectManager) === filter.projectManagerId)
        .map(p => p.id);
      records = records.filter(r => validProjectIds.includes(r.projectId));
    }
    if (filter.deadlineFrom || filter.deadlineTo) {
      const reminderMap: Record<string, StatusReminder | RiskAlert> = {};
      for (const sr of this.statusReminders.values()) reminderMap[sr.id] = sr;
      for (const ra of this.riskAlerts.values()) reminderMap[ra.id] = ra;
      records = records.filter(r => {
        const rm = reminderMap[r.reminderId];
        if (!rm || !rm.handlingDeadline) return false;
        const dl = rm.handlingDeadline;
        if (filter.deadlineFrom && dl < filter.deadlineFrom) return false;
        if (filter.deadlineTo && dl > filter.deadlineTo) return false;
        return true;
      });
    }
    return records.sort((a, b) => new Date(b.handledAt).getTime() - new Date(a.handledAt).getTime());
  }

  getOverdueRank(limit: number = 10): OverdueRankItem[] {
    const now = dayjs();
    const items: OverdueRankItem[] = [];
    for (const sr of this.statusReminders.values()) {
      if (['overdue_unhandled', 'unread', 'read', 'in_progress'].includes(sr.handlingStatus) && sr.handlingDeadline) {
        const dl = dayjs(sr.handlingDeadline);
        if (now.isAfter(dl)) {
          items.push({
            reminderId: sr.id,
            reminderType: sr.type,
            projectId: sr.projectId,
            projectName: sr.projectName,
            title: sr.title || `${sr.changeCode} ${sr.changeTitle}`,
            projectManagerId: sr.projectManagerId,
            projectManagerName: sr.projectManagerName,
            handlingStatus: sr.handlingStatus,
            overdueDays: now.diff(dl, 'day'),
            handlingDeadline: sr.handlingDeadline,
            stage: sr.stage,
          });
        }
      }
    }
    for (const ra of this.riskAlerts.values()) {
      if (['overdue_unhandled', 'unread', 'read', 'in_progress'].includes(ra.handlingStatus) && ra.handlingDeadline) {
        const dl = dayjs(ra.handlingDeadline);
        if (now.isAfter(dl)) {
          items.push({
            reminderId: ra.id,
            reminderType: ra.type,
            projectId: ra.projectId,
            projectName: ra.projectName,
            title: ra.title || `${ra.projectName}-${ra.professional}-${ra.changeCount}条变更`,
            projectManagerId: this.getProject(ra.projectId)?.projectManagerId || this.getProject(ra.projectId)?.projectManager,
            projectManagerName: this.getProject(ra.projectId)?.projectManagerName || this.getProject(ra.projectId)?.projectManager,
            handlingStatus: ra.handlingStatus,
            overdueDays: now.diff(dl, 'day'),
            handlingDeadline: ra.handlingDeadline,
          });
        }
      }
    }
    return items
      .sort((a, b) => b.overdueDays - a.overdueDays)
      .slice(0, limit);
  }

  getRecentHandlingActivities(limit: number = 20): RecentHandlingActivity[] {
    const records = Array.from(this.reminderHandlingRecords.values())
      .sort((a, b) => new Date(b.handledAt).getTime() - new Date(a.handledAt).getTime())
      .slice(0, limit);
    return records.map(r => ({
      recordId: r.id,
      reminderId: r.reminderId,
      reminderType: r.reminderType,
      projectId: r.projectId,
      projectName: r.projectName,
      title: (this.getStatusReminder(r.reminderId)?.title || this.getStatusReminder(r.reminderId)?.changeTitle
        || this.getRiskAlert(r.reminderId)?.title || ''),
      previousStatus: r.previousStatus,
      newStatus: r.newStatus,
      handledBy: r.handledBy,
      handledAt: r.handledAt,
      handlingNote: r.handlingNote,
    }));
  }

  getReminderFullFlow(reminderType: 'status_overdue' | 'risk_alert', reminderId: string): ReminderFullFlow | undefined {
    const reminder = reminderType === 'status_overdue'
      ? this.getStatusReminder(reminderId)
      : this.getRiskAlert(reminderId);
    if (!reminder) return undefined;

    const records = this.getHandlingRecordsByReminder(reminderId).slice().reverse();
    const startTime = new Date(reminder.createdAt).getTime();
    let lastTime = startTime;
    const steps: ReminderFlowStep[] = [];
    records.forEach((r, idx) => {
      const at = new Date(r.handledAt).getTime();
      steps.push({
        stepIndex: idx + 1,
        previousStatus: r.previousStatus,
        newStatus: r.newStatus,
        handledBy: r.handledBy,
        handledAt: r.handledAt,
        handlingNote: r.handlingNote,
        handlingAttachments: r.handlingAttachments,
        durationMinutesFromStart: Math.floor((at - startTime) / 60000),
      });
      lastTime = at;
    });
    if (steps.length === 0 || steps[0].previousStatus !== 'unread') {
      steps.unshift({
        stepIndex: 0,
        previousStatus: null,
        newStatus: 'unread',
        handledBy: 'system',
        handledAt: reminder.createdAt,
        handlingNote: '系统生成提醒',
        durationMinutesFromStart: 0,
      });
    }

    return {
      reminderId,
      reminderType,
      projectId: reminder.projectId,
      projectName: reminder.projectName,
      title: (reminder as any).title || (reminder as any).changeTitle || (reminder as any).suggestion?.slice(0, 40) || '',
      currentStatus: reminder.handlingStatus,
      createdAt: reminder.createdAt,
      handlingDeadline: reminder.handlingDeadline,
      steps,
      totalDurationMinutes: Math.floor((Date.now() - startTime) / 60000),
      handlingNote: reminder.handlingNote,
      handlingAttachments: reminder.handlingAttachments,
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
