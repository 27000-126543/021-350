import { v4 as uuidv4 } from 'uuid';
import { Project, ChangeNegotiation, StatusReminder, RiskAlert, WeeklySummary, ReminderRules, defaultReminderRules } from '../types';

class DataStore {
  private projects: Map<string, Project> = new Map();
  private changes: Map<string, ChangeNegotiation> = new Map();
  private statusReminders: Map<string, StatusReminder> = new Map();
  private riskAlerts: Map<string, RiskAlert> = new Map();
  private weeklySummaries: Map<string, WeeklySummary> = new Map();
  private reminderRules: ReminderRules = { ...defaultReminderRules };

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

  getStatusRemindersByProject(projectId: string): StatusReminder[] {
    return Array.from(this.statusReminders.values()).filter(r => r.projectId === projectId);
  }

  getAllStatusReminders(): StatusReminder[] {
    return Array.from(this.statusReminders.values());
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

  addWeeklySummary(summary: WeeklySummary): WeeklySummary {
    this.weeklySummaries.set(summary.id, summary);
    return summary;
  }

  getLatestWeeklySummary(): WeeklySummary | undefined {
    const summaries = Array.from(this.weeklySummaries.values());
    if (summaries.length === 0) return undefined;
    return summaries.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
  }

  getAllWeeklySummaries(): WeeklySummary[] {
    return Array.from(this.weeklySummaries.values());
  }

  getReminderRules(): ReminderRules {
    return { ...this.reminderRules };
  }

  updateReminderRules(rules: Partial<ReminderRules>): ReminderRules {
    this.reminderRules = { ...this.reminderRules, ...rules };
    return { ...this.reminderRules };
  }

  clearAll(): void {
    this.projects.clear();
    this.changes.clear();
    this.statusReminders.clear();
    this.riskAlerts.clear();
    this.weeklySummaries.clear();
  }
}

export const dataStore = new DataStore();
