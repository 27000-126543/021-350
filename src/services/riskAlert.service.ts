import dayjs from 'dayjs';
import { dataStore } from '../store/dataStore';
import {
  RiskAlert,
  ChangeNegotiation,
  ChangeCategory,
  Professional,
  RiskFactorItem,
  categoryLabels,
  professionalLabels,
  ComprehensiveRiskView,
  RiskCategoryBreakdown,
} from '../types';
import { pushRecordService } from './pushRecord.service';

type RiskGroupKey = string;
type ComprehensiveKey = string;

export class RiskAlertService {
  async detectAndGenerateAlerts(autoCreatePushRecords: boolean = true): Promise<{
    categoryAlerts: RiskAlert[];
    comprehensiveViews: ComprehensiveRiskView[];
    pushRecords: number;
  }> {
    const rules = dataStore.getReminderRules();
    const allChanges = dataStore.getAllChanges();

    const categoryAlerts = await this.generateCategoryAlerts(allChanges, rules);
    const comprehensiveViews = this.generateComprehensiveViews(allChanges, rules);

    let pushRecordCount = 0;
    if (autoCreatePushRecords) {
      const pushChannels = rules.riskAlertChannels;
      for (const alert of categoryAlerts) {
        const records = pushRecordService.createPushRecordForRiskAlert(alert, pushChannels, 'pending');
        pushRecordCount += records.length;
      }
      for (const view of comprehensiveViews) {
        if (view.overallRiskLevel === 'high' || view.overallRiskLevel === 'medium') {
          const pushReminder = {
            ...view,
            type: 'risk_alert' as const,
            id: view.id,
            category: 'other' as ChangeCategory,
            changeCount: view.totalChangeCount,
            timeWindowDays: view.timeWindowDays,
            totalEstimatedAmount: view.totalEstimatedAmount,
            changes: view.categoryBreakdown.flatMap(b => b.changes),
            riskLevel: view.overallRiskLevel,
            title: `综合风险视图·${view.projectName}（${view.totalChangeCount}条）`,
            suggestion: view.overallSuggestion,
            handlingStatus: 'unread' as const,
            createdAt: view.createdAt,
          };
          const records = pushRecordService.createPushRecordForRiskAlert(
            pushReminder as any,
            pushChannels,
            'pending'
          );
          pushRecordCount += records.length;
        }
      }
    }

    return { categoryAlerts, comprehensiveViews, pushRecords: pushRecordCount };
  }

  private async generateCategoryAlerts(
    allChanges: ChangeNegotiation[],
    rules: { riskTimeWindowDays: number; riskThresholdCount: number; highRiskThresholdCount: number }
  ): Promise<RiskAlert[]> {
    const alerts: RiskAlert[] = [];
    const existingAlertKeys = new Set(
      dataStore.getAllRiskAlerts().map(a => `${a.projectId}::${a.category}::${a.professional}`)
    );

    const groupedChanges = this.groupChangesByCategory(allChanges);

    for (const [key, changes] of Object.entries(groupedChanges)) {
      const recentChanges = changes.filter(c => {
        const daysSinceRegistered = dayjs().diff(dayjs(c.registeredDate), 'day');
        return daysSinceRegistered <= rules.riskTimeWindowDays;
      });

      if (recentChanges.length < rules.riskThresholdCount) continue;
      if (existingAlertKeys.has(key)) {
        const existing = dataStore.getAllRiskAlerts().find(
          a => `${a.projectId}::${a.category}::${a.professional}` === key
        );
        if (existing) {
          dataStore.updateRiskAlert(existing.id, {
            changeCount: recentChanges.length,
            totalEstimatedAmount: recentChanges.reduce((s, c) => s + c.estimatedAmount, 0),
            changes: recentChanges
              .sort((a, b) => dayjs(b.registeredDate).valueOf() - dayjs(a.registeredDate).valueOf())
              .map(c => this.toRiskFactorItem(c)),
            riskLevel: recentChanges.length >= rules.highRiskThresholdCount ? 'high' : 'medium',
          });
        }
        continue;
      }

      const { projectId, category, professional } = this.parseRiskKey(key);
      const project = dataStore.getProject(projectId);
      if (!project) continue;

      const fullRules = dataStore.getReminderRules();
      const riskLevel = recentChanges.length >= rules.highRiskThresholdCount ? 'high' : 'medium';
      const totalAmount = recentChanges.reduce((s, c) => s + c.estimatedAmount, 0);
      const handlingDeadline = dayjs().add(fullRules.reminderHandlingDeadlineDays, 'day').toISOString();

      const riskItems = recentChanges
        .sort((a, b) => dayjs(b.registeredDate).valueOf() - dayjs(a.registeredDate).valueOf())
        .map(c => this.toRiskFactorItem(c));

      const alert: RiskAlert = {
        id: dataStore.generateId(),
        type: 'risk_alert',
        projectId,
        projectName: project.name,
        category: category as ChangeCategory,
        professional: professional as Professional,
        changeCount: recentChanges.length,
        timeWindowDays: rules.riskTimeWindowDays,
        totalEstimatedAmount: totalAmount,
        changes: riskItems,
        riskLevel,
        title: `风险提示·${professional}专业·${category}类变更集中出现（${recentChanges.length}条）`,
        suggestion: this.generateCategorySuggestion(
          category as ChangeCategory,
          professional as Professional,
          recentChanges.length,
          riskLevel,
          rules.riskTimeWindowDays
        ),
        handlingStatus: 'unread',
        handlingDeadline,
        createdAt: dayjs().toISOString(),
      };

      dataStore.addRiskAlert(alert);
      alerts.push(alert);
    }

    return alerts;
  }

  private generateComprehensiveViews(
    allChanges: ChangeNegotiation[],
    rules: {
      riskTimeWindowDays: number;
      riskThresholdCount: number;
      highRiskThresholdCount: number;
      comprehensiveRiskThresholdCount: number;
    }
  ): ComprehensiveRiskView[] {
    const views: ComprehensiveRiskView[] = [];
    const grouped = this.groupChangesByProfessional(allChanges);
    const now = dayjs().toISOString();

    for (const [key, changes] of Object.entries(grouped)) {
      const recentChanges = changes.filter(c => {
        const days = dayjs().diff(dayjs(c.registeredDate), 'day');
        return days <= rules.riskTimeWindowDays && c.category !== 'other';
      });

      if (recentChanges.length < rules.comprehensiveRiskThresholdCount) continue;

      const { projectId, professional } = this.parseComprehensiveKey(key);
      const project = dataStore.getProject(projectId);
      if (!project) continue;

      const categoryBreakdown = this.buildCategoryBreakdown(
        recentChanges,
        professional as Professional,
        rules.riskThresholdCount,
        rules.highRiskThresholdCount,
        rules.riskTimeWindowDays
      );

      const totalCount = recentChanges.length;
      const totalAmount = recentChanges.reduce((s, c) => s + c.estimatedAmount, 0);
      const highRiskCategories = categoryBreakdown.filter(
        b => b.count >= rules.highRiskThresholdCount
      ).length;
      const mediumRiskCategories = categoryBreakdown.filter(
        b => b.count >= rules.riskThresholdCount && b.count < rules.highRiskThresholdCount
      ).length;

      let overallRiskLevel: 'high' | 'medium' | 'low' = 'low';
      if (highRiskCategories >= 1 || totalCount >= rules.highRiskThresholdCount * 2) {
        overallRiskLevel = 'high';
      } else if (mediumRiskCategories >= 1 || totalCount >= rules.comprehensiveRiskThresholdCount) {
        overallRiskLevel = 'medium';
      }

      const meetingFocus = this.buildMeetingFocus(categoryBreakdown, professional as Professional);
      const overallSuggestion = this.buildOverallSuggestion(
        project.name,
        professional as Professional,
        overallRiskLevel,
        totalCount,
        categoryBreakdown,
        meetingFocus,
        rules.riskTimeWindowDays
      );

      const view: ComprehensiveRiskView = {
        id: dataStore.generateId(),
        projectId,
        projectName: project.name,
        professional: professional as Professional,
        timeWindowDays: rules.riskTimeWindowDays,
        totalChangeCount: totalCount,
        totalEstimatedAmount: totalAmount,
        overallRiskLevel,
        categoryBreakdown,
        meetingFocus,
        overallSuggestion,
        createdAt: now,
        lastUpdatedAt: now,
      };

      dataStore.saveComprehensiveRiskView(view);
      views.push(view);
    }

    return views;
  }

  private toRiskFactorItem(change: ChangeNegotiation): RiskFactorItem {
    return {
      changeId: change.id,
      changeCode: change.code,
      changeTitle: change.title,
      registeredDate: change.registeredDate,
      estimatedAmount: change.estimatedAmount,
      category: change.category,
    };
  }

  private groupChangesByCategory(changes: ChangeNegotiation[]): Record<RiskGroupKey, ChangeNegotiation[]> {
    const groups: Record<RiskGroupKey, ChangeNegotiation[]> = {};
    for (const change of changes) {
      if (change.category === 'other') continue;
      if (change.status === 'rejected') continue;
      const key = `${change.projectId}::${change.category}::${change.professional}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(change);
    }
    return groups;
  }

  private groupChangesByProfessional(changes: ChangeNegotiation[]): Record<ComprehensiveKey, ChangeNegotiation[]> {
    const groups: Record<ComprehensiveKey, ChangeNegotiation[]> = {};
    for (const change of changes) {
      if (change.status === 'rejected') continue;
      const key = `${change.projectId}::${change.professional}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(change);
    }
    return groups;
  }

  private parseRiskKey(key: RiskGroupKey): { projectId: string; category: string; professional: string } {
    const [projectId, category, professional] = key.split('::');
    return { projectId, category, professional };
  }

  private parseComprehensiveKey(key: ComprehensiveKey): { projectId: string; professional: string } {
    const [projectId, professional] = key.split('::');
    return { projectId, professional };
  }

  private buildCategoryBreakdown(
    changes: ChangeNegotiation[],
    professional: Professional,
    threshold: number,
    highThreshold: number,
    timeWindowDays: number = 30
  ): RiskCategoryBreakdown[] {
    const byCategory: Record<string, ChangeNegotiation[]> = {};
    for (const c of changes) {
      if (!byCategory[c.category]) byCategory[c.category] = [];
      byCategory[c.category].push(c);
    }

    const breakdown: RiskCategoryBreakdown[] = [];
    for (const [cat, catChanges] of Object.entries(byCategory)) {
      const count = catChanges.length;
      if (count < Math.max(2, Math.ceil(threshold / 2))) continue;

      const items = catChanges
        .sort((a, b) => dayjs(b.registeredDate).valueOf() - dayjs(a.registeredDate).valueOf())
        .map(c => this.toRiskFactorItem(c));

      const totalAmount = catChanges.reduce((s, c) => s + c.estimatedAmount, 0);
      const riskLevel = count >= highThreshold ? 'high' : count >= threshold ? 'medium' : 'low';

      breakdown.push({
        category: cat as ChangeCategory,
        count,
        totalAmount,
        changes: items,
        suggestion: this.generateCategorySuggestion(
          cat as ChangeCategory,
          professional,
          count,
          riskLevel,
          timeWindowDays
        ),
      });
    }

    return breakdown.sort((a, b) => b.count - a.count);
  }

  private generateCategorySuggestion(
    category: ChangeCategory,
    professional: Professional,
    count: number,
    riskLevel: 'high' | 'medium' | 'low',
    timeWindowDays: number = 30
  ): string {
    const categoryText = categoryLabels[category];
    const professionalText = professionalLabels[professional];
    const levelPrefix = riskLevel === 'high' ? '【高风险】' : riskLevel === 'medium' ? '【中风险】' : '【关注】';

    const suggestions: Record<ChangeCategory, string> = {
      design_omission: `近${timeWindowDays}天${professionalText}专业出现${count}起设计遗漏类变更，建议项目部组织设计、施工、监理三方召开专题会，系统性复核施工图纸，建立图纸会审清单制度，避免同类问题重复发生。`,
      site_condition: `近${timeWindowDays}天${professionalText}专业出现${count}起现场条件变化类变更，建议项目部集中比对勘察资料与现场实际，评估对工期造价的总体影响，完善地质条件确认、签证影像、工程量确认单等索赔证据链。`,
      material_substitution: `近${timeWindowDays}天${professionalText}专业出现${count}起材料替换类变更，建议项目部专题评审替换方案的成本增量、性能指标与供应周期，建立材料选型封样制度，统一设计变更流程和报审口径。`,
      other: `近${timeWindowDays}天${professionalText}专业出现${count}起其他类变更，请项目部核查变更原因，完善资料归档。`,
    };

    return levelPrefix + suggestions[category];
  }

  private buildMeetingFocus(
    breakdown: RiskCategoryBreakdown[],
    professional: Professional
  ): string[] {
    const focus: string[] = [];
    const professionalText = professionalLabels[professional];

    for (const b of breakdown) {
      const catText = categoryLabels[b.category];
      const topItems = b.changes.slice(0, 3).map(c => c.changeTitle).join('、');
      focus.push(
        `${catText}问题（${b.count}条，¥${b.totalAmount.toLocaleString()}）：重点讨论「${topItems}」等${professionalText}专业共性问题的根因与整改措施`
      );
    }

    focus.push('变更资料完整性检查：评估当前签证证据链是否满足结算与索赔要求');
    focus.push('后续变更预防措施：建立专业会审、图纸复核的长效机制');
    return focus;
  }

  private buildOverallSuggestion(
    projectName: string,
    professional: Professional,
    riskLevel: 'high' | 'medium' | 'low',
    totalCount: number,
    breakdown: RiskCategoryBreakdown[],
    meetingFocus: string[],
    timeWindowDays: number = 30
  ): string {
    const professionalText = professionalLabels[professional];
    const levelText = riskLevel === 'high' ? '高风险' : riskLevel === 'medium' ? '中风险' : '需关注';
    const categories = breakdown.map(b => categoryLabels[b.category]).join('、');

    return `【${levelText}】${projectName}的${professionalText}专业在近${timeWindowDays}天内共出现${totalCount}条变更（涉及${categories}），` +
      `累计涉及金额较大，存在成本失控与索赔证据不足风险。` +
      `建议由工程管理部牵头，${riskLevel === 'high' ? '3个工作日内' : '本周内'}组织设计、施工、监理、造价四方召开专题会，` +
      `围绕以下重点展开：${meetingFocus.slice(0, 2).join('；')}。会后形成会议纪要并跟踪整改落实。（统计口径：近${timeWindowDays}天）`;
  }

  getAlertsByProject(projectId: string): RiskAlert[] {
    return dataStore.getRiskAlertsByProject(projectId);
  }

  getAllAlerts(): RiskAlert[] {
    return dataStore.getAllRiskAlerts();
  }

  getComprehensiveViews(projectId?: string): ComprehensiveRiskView[] {
    return dataStore.getComprehensiveRiskViews(projectId);
  }

  getComprehensiveViewById(id: string): ComprehensiveRiskView | undefined {
    return dataStore.getComprehensiveRiskViewById(id);
  }

  formatAlertMessage(alert: RiskAlert): string {
    const categoryText = categoryLabels[alert.category];
    const professionalText = professionalLabels[alert.professional];
    const riskLevelText = alert.riskLevel === 'high' ? '高风险' : '中风险';

    let message = `【变更洽商风险提示】
风险等级：${riskLevelText}
项目名称：${alert.projectName}
专业类别：${professionalText}
变更类型：${categoryText}
时间窗口：近 ${alert.timeWindowDays} 天
变更数量：${alert.changeCount} 条
预计金额：¥${alert.totalEstimatedAmount.toLocaleString()}

涉及变更：
`;

    alert.changes.forEach((c, i) => {
      message += `  ${i + 1}. ${c.changeCode} - ${c.changeTitle}（${c.registeredDate}，¥${c.estimatedAmount.toLocaleString()}）\n`;
    });

    message += `\n建议措施：${alert.suggestion}\n`;
    message += '——工程管理部智能提醒中心';
    return message;
  }

  formatAlertDigest(alerts: RiskAlert[]): string {
    if (alerts.length === 0) return '暂无分类风险提示，各专业变更情况正常。';

    const highRiskCount = alerts.filter(a => a.riskLevel === 'high').length;
    const mediumRiskCount = alerts.filter(a => a.riskLevel === 'medium').length;

    let message = `【变更洽商分类风险汇总】共 ${alerts.length} 条风险提示，其中高风险 ${highRiskCount} 条，中风险 ${mediumRiskCount} 条。\n\n`;

    alerts.forEach((alert, i) => {
      const categoryText = categoryLabels[alert.category];
      const professionalText = professionalLabels[alert.professional];
      const levelIcon = alert.riskLevel === 'high' ? '🔴' : '🟡';
      message += `${levelIcon} ${alert.projectName} - ${professionalText}/${categoryText}（${alert.changeCount}条，¥${alert.totalEstimatedAmount.toLocaleString()}）\n`;
    });

    message += '\n请各项目部高度重视，及时组织专题研究，防范成本失控和索赔风险。';
    return message;
  }

  formatComprehensiveViewText(view: ComprehensiveRiskView, includeDetail: boolean = true): string {
    const professionalText = professionalLabels[view.professional];
    const levelText = view.overallRiskLevel === 'high' ? '高风险' : view.overallRiskLevel === 'medium' ? '中风险' : '需关注';
    const levelIcon = view.overallRiskLevel === 'high' ? '🔴' : view.overallRiskLevel === 'medium' ? '🟡' : '🟢';

    let message = `${levelIcon}【综合风险视图】${view.projectName} - ${professionalText}专业（${levelText}）
统计窗口：近 ${view.timeWindowDays} 天
累计变更：${view.totalChangeCount} 条
累计金额：¥${view.totalEstimatedAmount.toLocaleString()}

分类明细：
`;

    view.categoryBreakdown.forEach((b, i) => {
      const catText = categoryLabels[b.category];
      const riskTag = b.count >= 5 ? '🔴' : b.count >= 3 ? '🟡' : '⚪';
      message += `  ${i + 1}. ${riskTag} ${catText}：${b.count}条 / ¥${b.totalAmount.toLocaleString()}\n`;
      if (includeDetail) {
        b.changes.slice(0, 3).forEach(c => {
          message += `       · ${c.changeCode} ${c.changeTitle}（${c.registeredDate}）\n`;
        });
        message += `       建议：${b.suggestion.slice(0, 60)}...\n`;
      }
    });

    message += `\n专题会重点：\n`;
    view.meetingFocus.slice(0, 3).forEach((f, i) => {
      message += `  ${i + 1}. ${f}\n`;
    });

    message += `\n总体建议：${view.overallSuggestion}\n`;
    message += '——工程管理部智能提醒中心';
    return message;
  }
}

export const riskAlertService = new RiskAlertService();
