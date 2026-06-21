export type ChangeCategory = 'design_omission' | 'site_condition' | 'material_substitution' | 'other';

export type ChangeStatus = 'registered' | 'supervisor_review' | 'design_review' | 'closed' | 'rejected';

export type Professional = 'architecture' | 'structure' | 'mechanical' | 'electrical' | 'plumbing' | 'landscape';

export type ReminderType = 'status_overdue' | 'risk_alert' | 'weekly_summary';

export interface Project {
  id: string;
  name: string;
  code: string;
  projectManager: string;
  projectManagerPhone: string;
  constructionScale: string;
  startDate: string;
  endDate: string;
}

export interface ChangeNegotiation {
  id: string;
  projectId: string;
  code: string;
  title: string;
  category: ChangeCategory;
  professional: Professional;
  status: ChangeStatus;
  registeredDate: string;
  estimatedAmount: number;
  description: string;
  supervisorOpinion?: string;
  supervisorOpinionDate?: string;
  designOpinion?: string;
  designOpinionDate?: string;
  closedDate?: string;
  submitter: string;
  attachments?: string[];
}

export interface StatusReminder {
  id: string;
  type: 'status_overdue';
  projectId: string;
  projectName: string;
  changeId: string;
  changeCode: string;
  changeTitle: string;
  category: ChangeCategory;
  professional: Professional;
  overdueDays: number;
  currentStatus: ChangeStatus;
  registeredDate: string;
  dueDate: string;
  recipient: string;
  recipientPhone: string;
  createdAt: string;
}

export interface RiskFactorItem {
  changeId: string;
  changeCode: string;
  changeTitle: string;
  registeredDate: string;
  estimatedAmount: number;
}

export interface RiskAlert {
  id: string;
  type: 'risk_alert';
  projectId: string;
  projectName: string;
  category: ChangeCategory;
  professional: Professional;
  changeCount: number;
  timeWindowDays: number;
  totalEstimatedAmount: number;
  changes: RiskFactorItem[];
  riskLevel: 'high' | 'medium' | 'low';
  suggestion: string;
  createdAt: string;
}

export interface ProjectWeeklyStats {
  projectId: string;
  projectName: string;
  newCount: number;
  closedCount: number;
  totalOutstanding: number;
  closureRate: number;
  totalEstimatedAmount: number;
  overdueCount: number;
  overdueItems: {
    changeId: string;
    changeCode: string;
    changeTitle: string;
    overdueDays: number;
  }[];
}

export interface WeeklySummary {
  id: string;
  type: 'weekly_summary';
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  totalProjects: number;
  totalNewChanges: number;
  totalClosedChanges: number;
  overallClosureRate: number;
  totalEstimatedAmount: number;
  totalOverdueCount: number;
  projectStats: ProjectWeeklyStats[];
  topRiskProjects: {
    projectId: string;
    projectName: string;
    riskCount: number;
  }[];
  summaryText: string;
}

export interface ReminderRules {
  supervisorReviewDays: number;
  designReviewDays: number;
  riskTimeWindowDays: number;
  riskThresholdCount: number;
  highRiskThresholdCount: number;
  weeklySummaryDay: number;
  weeklySummaryHour: number;
}

export const defaultReminderRules: ReminderRules = {
  supervisorReviewDays: 7,
  designReviewDays: 14,
  riskTimeWindowDays: 15,
  riskThresholdCount: 3,
  highRiskThresholdCount: 5,
  weeklySummaryDay: 1,
  weeklySummaryHour: 9,
};

export const categoryLabels: Record<ChangeCategory, string> = {
  design_omission: '设计遗漏',
  site_condition: '现场条件变化',
  material_substitution: '材料替换',
  other: '其他',
};

export const statusLabels: Record<ChangeStatus, string> = {
  registered: '已登记',
  supervisor_review: '监理审核中',
  design_review: '设计审核中',
  closed: '已闭合',
  rejected: '已驳回',
};

export const professionalLabels: Record<Professional, string> = {
  architecture: '建筑',
  structure: '结构',
  mechanical: '暖通',
  electrical: '电气',
  plumbing: '给排水',
  landscape: '园林',
};

export const riskLevelLabels: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};
