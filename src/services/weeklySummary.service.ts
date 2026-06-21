import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  WeeklySummary,
  ProjectWeeklyStats,
  ChangeNegotiation,
  WeeklyStructuredData,
  WeeklyDimensionBucket,
  WeeklyTrendPoint,
  professionalLabels,
  categoryLabels,
  stageLabels,
  ReminderStage,
} from '../types';
import { statusReminderService } from './statusReminder.service';
import { pushRecordService } from './pushRecord.service';

export class WeeklySummaryService {
  async generateWeeklySummary(
    isAuto: boolean = false,
    autoCreatePushRecord: boolean = true
  ): Promise<{ summary: WeeklySummary; pushRecordCount: number }> {
    const now = dayjs();
    const weekStart = now.startOf('week').add(1, 'day').format('YYYY-MM-DD');
    const weekEnd = now.endOf('week').add(1, 'day').format('YYYY-MM-DD');

    const existing = dataStore.getWeeklySummariesByWeek(weekStart, weekEnd);
    if (existing && !isAuto) {
      return { summary: existing, pushRecordCount: 0 };
    }

    const projects = dataStore.getAllProjects();
    const allChanges = dataStore.getAllChanges();

    const projectStats: ProjectWeeklyStats[] = [];
    let totalNewChanges = 0;
    let totalClosedChanges = 0;
    let totalEstimatedAmount = 0;
    let totalOverdueCount = 0;
    let totalOutstanding = 0;

    for (const project of projects) {
      const projectChanges = allChanges.filter(c => c.projectId === project.id);
      const stats = this.calculateProjectStats(project, projectChanges, weekStart, weekEnd);
      projectStats.push(stats);

      totalNewChanges += stats.newCount;
      totalClosedChanges += stats.closedCount;
      totalEstimatedAmount += stats.totalEstimatedAmount;
      totalOverdueCount += stats.overdueCount;
      totalOutstanding += stats.totalOutstanding;
    }

    const totalClosed = allChanges.filter(c => c.status === 'closed').length;
    const overallClosureRate = allChanges.length > 0
      ? Math.round((totalClosed / allChanges.length) * 100)
      : 0;

    const riskAlerts = dataStore.getAllRiskAlerts();
    const totalRiskAlerts = riskAlerts.length;

    const topRiskProjects = this.getTopProjectsByMetric(projectStats, 'newCount', 5);
    const topOverdueProjects = this.getTopProjectsByMetric(projectStats, 'overdueCount', 5);

    const summaryText = this.generateSummaryText(
      projects.length,
      totalNewChanges,
      totalClosedChanges,
      totalOutstanding,
      overallClosureRate,
      totalEstimatedAmount,
      totalOverdueCount,
      totalRiskAlerts,
      topRiskProjects,
      topOverdueProjects,
      weekStart,
      weekEnd
    );

    const smsText = this.generateSmsText(
      totalNewChanges,
      totalClosedChanges,
      totalOverdueCount,
      overallClosureRate,
      totalRiskAlerts
    );

    const structuredData = this.buildStructuredData(
      projects,
      allChanges,
      weekStart,
      weekEnd
    );
    structuredData.weeklyTrend = this.buildTrendData(8);

    const summary: WeeklySummary = {
      id: dataStore.generateId(),
      type: 'weekly_summary',
      weekStart,
      weekEnd,
      generatedAt: now.toISOString(),
      generatedAutomatically: isAuto,
      totalProjects: projects.length,
      totalNewChanges,
      totalClosedChanges,
      overallClosureRate,
      totalEstimatedAmount,
      totalOverdueCount,
      totalRiskAlerts,
      projectStats,
      topRiskProjects: topRiskProjects.map(p => ({
        projectId: p.projectId,
        projectName: p.projectName,
        riskCount: p.newCount,
      })),
      topOverdueProjects: topOverdueProjects.map(p => ({
        projectId: p.projectId,
        projectName: p.projectName,
        overdueCount: p.overdueCount,
      })),
      summaryText,
      smsText,
      structuredData,
    };

    dataStore.addWeeklySummary(summary);

    let pushRecordCount = 0;
    if (autoCreatePushRecord) {
      const records = pushRecordService.createPushRecordForWeeklySummary(
        summary,
        ['system', 'email'],
        'pending'
      );
      pushRecordCount = records.length;
    }

    return { summary, pushRecordCount };
  }

  private calculateProjectStats(
    project: { id: string; name: string },
    changes: ChangeNegotiation[],
    weekStart: string,
    weekEnd: string
  ): ProjectWeeklyStats {
    const weekStartDate = dayjs(weekStart);
    const weekEndDate = dayjs(weekEnd);

    const newCount = changes.filter(c => {
      const registered = dayjs(c.registeredDate);
      return registered.isAfter(weekStartDate.subtract(1, 'ms')) && registered.isBefore(weekEndDate);
    }).length;

    const closedCount = changes.filter(c => {
      if (!c.closedDate) return false;
      const closed = dayjs(c.closedDate);
      return closed.isAfter(weekStartDate.subtract(1, 'ms')) && closed.isBefore(weekEndDate);
    }).length;

    const totalOutstanding = changes.filter(c =>
      c.status !== 'closed' && c.status !== 'rejected'
    ).length;

    const totalChanges = changes.length;
    const closureRate = totalChanges > 0
      ? Math.round((changes.filter(c => c.status === 'closed').length / totalChanges) * 100)
      : 0;

    const totalEstimatedAmount = changes.reduce((sum, c) => sum + c.estimatedAmount, 0);

    const overdueChanges = statusReminderService.getOverdueChanges(project.id);
    const overdueCount = overdueChanges.length;

    const overdueItems = overdueChanges
      .sort((a, b) => {
        const ad = this.calculateOverdueDays(a);
        const bd = this.calculateOverdueDays(b);
        return bd - ad;
      })
      .slice(0, 5)
      .map(c => ({
        changeId: c.id,
        changeCode: c.code,
        changeTitle: c.title,
        overdueDays: this.calculateOverdueDays(c),
      }));

    return {
      projectId: project.id,
      projectName: project.name,
      newCount,
      closedCount,
      totalOutstanding,
      closureRate,
      totalEstimatedAmount,
      overdueCount,
      overdueItems,
    };
  }

  private calculateOverdueDays(change: ChangeNegotiation): number {
    const rules = dataStore.getReminderRules();
    const now = dayjs();
    const registeredDate = dayjs(change.registeredDate);
    const supervisorOpinionDate = change.supervisorOpinionDate
      ? dayjs(change.supervisorOpinionDate)
      : null;
    const designOpinionDate = change.designOpinionDate
      ? dayjs(change.designOpinionDate)
      : null;

    let reviewDays: number;
    let baseDate: dayjs.Dayjs;

    switch (change.status) {
      case 'registered':
        reviewDays = rules.supervisorReviewDays;
        baseDate = registeredDate;
        break;
      case 'supervisor_review':
        reviewDays = rules.designReviewDays;
        baseDate = supervisorOpinionDate || registeredDate.add(rules.supervisorReviewDays, 'day');
        break;
      case 'design_review':
        reviewDays = rules.designReviewDays;
        baseDate = supervisorOpinionDate || registeredDate.add(rules.supervisorReviewDays, 'day');
        break;
      default:
        return 0;
    }

    const dueDate = baseDate.add(reviewDays, 'day');
    return Math.max(0, now.diff(dueDate, 'day'));
  }

  private getTopProjectsByMetric(
    stats: ProjectWeeklyStats[],
    metric: 'newCount' | 'overdueCount' | 'totalOutstanding',
    topN: number
  ): ProjectWeeklyStats[] {
    return [...stats]
      .sort((a, b) => b[metric] - a[metric])
      .filter(s => s[metric] > 0)
      .slice(0, topN);
  }

  private generateSummaryText(
    totalProjects: number,
    newCount: number,
    closedCount: number,
    outstandingCount: number,
    closureRate: number,
    totalAmount: number,
    overdueCount: number,
    riskAlerts: number,
    topRiskProjects: ProjectWeeklyStats[],
    topOverdueProjects: ProjectWeeklyStats[],
    weekStart: string,
    weekEnd: string
  ): string {
    let text = `【本周变更洽商管理简报】
统计周期：${weekStart} 至 ${weekEnd}
生成方式：系统自动生成
报告时间：${dayjs().format('YYYY-MM-DD HH:mm')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、总体情况
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • 覆盖在建项目：${totalProjects} 个
  • 本周新增变更：${newCount} 条
  • 本周闭合变更：${closedCount} 条
  • 当前未闭合数：${outstandingCount} 条
  • 整体闭合率：${closureRate}%
  • 累计预计金额：¥${totalAmount.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、过程管控指标
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • 超期待办总数：${overdueCount} 条
  • 风险提示数量：${riskAlerts} 条
  • 需重点关注项目：${Math.max(topRiskProjects.length, topOverdueProjects.length)} 个

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、重点项目 - 新增较多
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    if (topRiskProjects.length === 0) {
      text += '  本周新增变更平稳，无项目出现异常放量。\n';
    } else {
      topRiskProjects.forEach((p, i) => {
        text += `  ${i + 1}. ${p.projectName}：新增 ${p.newCount} 条 | 未闭合 ${p.totalOutstanding} 条 | 闭合率 ${p.closureRate}%\n`;
      });
    }

    text += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
四、重点项目 - 超期严重
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    if (topOverdueProjects.length === 0) {
      text += '  本周无严重超期项目，资料推进情况良好。\n';
    } else {
      topOverdueProjects.forEach((p, i) => {
        const overdueList = p.overdueItems.slice(0, 2).map(o => `${o.changeCode}(${o.overdueDays}天)`).join('、');
        text += `  ${i + 1}. ${p.projectName}：超期 ${p.overdueCount} 条 | 典型：${overdueList}\n`;
      });
    }

    text += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
五、管理建议与要求
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. 【台账时效性】各项目须在洽商发生后 3 个工作日内完成系统登记，禁止延后补录；
  2. 【资料闭合性】超期 7 天以上的条目须由项目经理说明原因并提交整改计划；
  3. 【风险预警处置】出现中/高风险提示的项目，须在 3 个工作日内召开专题会并上传会议纪要；
  4. 【索赔证据链】重点关注现场条件变化类变更，确保签证单、影像资料、工程量确认单完整；
  5. 【周报反馈】如有数据异议，请于 24 小时内反馈至工程管理部，逾期视为确认。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ——工程管理部 · 智能提醒中心
  本邮件由系统自动生成，请勿直接回复
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    return text;
  }

  private generateSmsText(
    newCount: number,
    closedCount: number,
    overdueCount: number,
    closureRate: number,
    riskAlerts: number
  ): string {
    return `【变更洽商周报】本周新增${newCount}条/闭合${closedCount}条/超期${overdueCount}条，整体闭合率${closureRate}%，风险提示${riskAlerts}条。详见管理系统或邮件简报。——工程管理部`;
  }

  getLatestSummary(): WeeklySummary | undefined {
    return dataStore.getLatestWeeklySummary();
  }

  getAllSummaries(): WeeklySummary[] {
    return dataStore.getAllWeeklySummaries();
  }

  getSummaryByWeek(weekStart: string, weekEnd: string): WeeklySummary | undefined {
    return dataStore.getWeeklySummariesByWeek(weekStart, weekEnd);
  }

  formatBriefingEmail(summary: WeeklySummary): string {
    return summary.summaryText;
  }

  formatBriefingSMS(summary: WeeklySummary): string {
    return summary.smsText;
  }

  getCurrentWeekRange(): { weekStart: string; weekEnd: string } {
    const now = dayjs();
    return {
      weekStart: now.startOf('week').add(1, 'day').format('YYYY-MM-DD'),
      weekEnd: now.endOf('week').add(1, 'day').format('YYYY-MM-DD'),
    };
  }

  private buildStructuredData(
    projects: { id: string; name: string }[],
    allChanges: ChangeNegotiation[],
    weekStart: string,
    weekEnd: string
  ): WeeklyStructuredData {
    const weekStartDate = dayjs(weekStart);
    const weekEndDate = dayjs(weekEnd);

    const byProject: WeeklyDimensionBucket[] = projects.map(p => {
      const changes = allChanges.filter(c => c.projectId === p.id);
      const inWeek = changes.filter(c => {
        const d = dayjs(c.registeredDate);
        return d.isAfter(weekStartDate.subtract(1, 'ms')) && d.isBefore(weekEndDate);
      });
      return {
        key: p.id,
        label: p.name,
        count: inWeek.length,
        totalAmount: inWeek.reduce((s, c) => s + c.estimatedAmount, 0),
        overdueCount: changes.filter(c => c.status !== 'closed' && c.status !== 'rejected' && this.calculateOverdueDays(c) > 0).length,
        closedCount: changes.filter(c => c.status === 'closed').length,
      };
    }).filter(b => b.count > 0 || b.overdueCount! > 0);

    const byProfessionalMap: Record<string, WeeklyDimensionBucket> = {};
    const byCategoryMap: Record<string, WeeklyDimensionBucket> = {};
    for (const c of allChanges) {
      const d = dayjs(c.registeredDate);
      if (!(d.isAfter(weekStartDate.subtract(1, 'ms')) && d.isBefore(weekEndDate))) continue;

      if (!byProfessionalMap[c.professional]) {
        byProfessionalMap[c.professional] = { key: c.professional, label: professionalLabels[c.professional] || c.professional, count: 0, totalAmount: 0 };
      }
      byProfessionalMap[c.professional].count++;
      byProfessionalMap[c.professional].totalAmount += c.estimatedAmount;

      if (!byCategoryMap[c.category]) {
        byCategoryMap[c.category] = { key: c.category, label: categoryLabels[c.category] || c.category, count: 0, totalAmount: 0 };
      }
      byCategoryMap[c.category].count++;
      byCategoryMap[c.category].totalAmount += c.estimatedAmount;
    }
    const byProfessional = Object.values(byProfessionalMap).sort((a, b) => b.count - a.count);
    const byCategory = Object.values(byCategoryMap).sort((a, b) => b.count - a.count);

    const stageOrder: ReminderStage[] = ['registered_to_supervisor', 'supervisor_to_design', 'design_to_close'];
    const byStage: WeeklyDimensionBucket[] = stageOrder.map(stage => {
      const count = allChanges.filter(c => {
        const rules = dataStore.getReminderRules();
        let match = false;
        if (stage === 'registered_to_supervisor') match = c.status === 'registered';
        else if (stage === 'supervisor_to_design') match = c.status === 'supervisor_review';
        else if (stage === 'design_to_close') match = c.status === 'design_review';
        return match;
      }).length;
      return {
        key: stage,
        label: stageLabels[stage],
        count,
        totalAmount: 0,
        overdueCount: allChanges.filter(c => {
          if (stage === 'registered_to_supervisor' && c.status !== 'registered') return false;
          if (stage === 'supervisor_to_design' && c.status !== 'supervisor_review') return false;
          if (stage === 'design_to_close' && c.status !== 'design_review') return false;
          return this.calculateOverdueDays(c) > 0;
        }).length,
      };
    });

    return { byProject, byProfessional, byCategory, byStage };
  }

  private buildTrendData(weeks: number): WeeklyTrendPoint[] {
    const summaries = dataStore.getWeeklySummariesTrend(weeks);
    return summaries.map(s => ({
      weekStart: s.weekStart,
      weekEnd: s.weekEnd,
      newCount: s.totalNewChanges,
      closedCount: s.totalClosedChanges,
      overdueCount: s.totalOverdueCount,
      riskAlertCount: s.totalRiskAlerts,
      totalEstimatedAmount: s.totalEstimatedAmount,
    }));
  }

  getTrendData(weeks: number = 8): WeeklyTrendPoint[] {
    return this.buildTrendData(weeks);
  }
}

export const weeklySummaryService = new WeeklySummaryService();
