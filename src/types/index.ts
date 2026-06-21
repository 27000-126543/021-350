export type ChangeCategory = 'design_omission' | 'site_condition' | 'material_substitution' | 'other';

export type ChangeStatus = 'registered' | 'supervisor_review' | 'design_review' | 'closed' | 'rejected';

export type Professional = 'architecture' | 'structure' | 'mechanical' | 'electrical' | 'plumbing' | 'landscape';

export type ReminderType = 'status_overdue' | 'risk_alert' | 'weekly_summary';

export type PushChannel = 'wecom' | 'sms' | 'email' | 'system' | 'contract_system';

export type PushResult = 'pending' | 'success' | 'failed';

export type ReminderStage = 'registered_to_supervisor' | 'supervisor_to_design' | 'design_to_close';

export interface Project {
  id: string;
  name: string;
  code: string;
  projectManager: string;
  projectManagerPhone: string;
  projectManagerEmail?: string;
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
  stage: ReminderStage;
  isActive: boolean;
  invalidatedAt?: string;
  invalidatedReason?: string;
  registeredDate: string;
  stageStartDate: string;
  dueDate: string;
  recipient: string;
  recipientPhone: string;
  recipientEmail?: string;
  createdAt: string;
  lastUpdatedAt: string;
}

export interface RiskFactorItem {
  changeId: string;
  changeCode: string;
  changeTitle: string;
  registeredDate: string;
  estimatedAmount: number;
  category: ChangeCategory;
}

export interface RiskCategoryBreakdown {
  category: ChangeCategory;
  count: number;
  totalAmount: number;
  changes: RiskFactorItem[];
  suggestion: string;
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

export interface ComprehensiveRiskView {
  id: string;
  projectId: string;
  projectName: string;
  professional: Professional;
  timeWindowDays: number;
  totalChangeCount: number;
  totalEstimatedAmount: number;
  overallRiskLevel: 'high' | 'medium' | 'low';
  categoryBreakdown: RiskCategoryBreakdown[];
  meetingFocus: string[];
  overallSuggestion: string;
  createdAt: string;
  lastUpdatedAt: string;
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
  generatedAutomatically: boolean;
  totalProjects: number;
  totalNewChanges: number;
  totalClosedChanges: number;
  overallClosureRate: number;
  totalEstimatedAmount: number;
  totalOverdueCount: number;
  totalRiskAlerts: number;
  projectStats: ProjectWeeklyStats[];
  topRiskProjects: {
    projectId: string;
    projectName: string;
    riskCount: number;
  }[];
  topOverdueProjects: {
    projectId: string;
    projectName: string;
    overdueCount: number;
  }[];
  summaryText: string;
  smsText: string;
}

export interface ReminderRules {
  supervisorReviewDays: number;
  designReviewDays: number;
  designFinalReviewDays: number;
  riskTimeWindowDays: number;
  riskThresholdCount: number;
  highRiskThresholdCount: number;
  comprehensiveRiskThresholdCount: number;
  weeklySummaryDay: number;
  weeklySummaryHour: number;
  weeklySummaryMinute: number;
  autoRunStatusCheck: boolean;
  autoRunRiskCheck: boolean;
  autoGenerateWeeklySummary: boolean;
  statusCheckCronExpression?: string;
  riskCheckCronExpression?: string;
}

export interface ReminderRulesLog {
  id: string;
  changedBy: string;
  previousRules: Partial<ReminderRules>;
  newRules: Partial<ReminderRules>;
  changedAt: string;
  description: string;
}

export const defaultReminderRules: ReminderRules = {
  supervisorReviewDays: 7,
  designReviewDays: 14,
  designFinalReviewDays: 21,
  riskTimeWindowDays: 15,
  riskThresholdCount: 3,
  highRiskThresholdCount: 5,
  comprehensiveRiskThresholdCount: 6,
  weeklySummaryDay: 1,
  weeklySummaryHour: 9,
  weeklySummaryMinute: 0,
  autoRunStatusCheck: true,
  autoRunRiskCheck: true,
  autoGenerateWeeklySummary: true,
};

export interface PushRecord {
  id: string;
  reminderType: ReminderType;
  reminderId: string;
  channel: PushChannel;
  recipientIds: string[];
  recipientNames: string[];
  recipientPhones: string[];
  recipientEmails: string[];
  title: string;
  content: string;
  summary?: string;
  result: PushResult;
  resultMessage?: string;
  generatedAt: string;
  pushedAt?: string;
  metadata?: Record<string, any>;
}

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

export const stageLabels: Record<ReminderStage, string> = {
  registered_to_supervisor: '登记→监理意见',
  supervisor_to_design: '监理→设计意见',
  design_to_close: '设计→最终闭合',
};

export const channelLabels: Record<PushChannel, string> = {
  wecom: '企业微信',
  sms: '短信',
  email: '邮件',
  system: '系统消息',
  contract_system: '合同系统',
};

export const resultLabels: Record<PushResult, string> = {
  pending: '待推送',
  success: '推送成功',
  failed: '推送失败',
};
