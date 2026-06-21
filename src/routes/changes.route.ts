import { Router, Request, Response } from 'express';
import { dataStore } from '../store/dataStore';
import { ChangeNegotiation, ChangeStatus, ChangeCategory, Professional } from '../types';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { projectId, status, category, professional, page = '1', pageSize = '100' } = req.query;
  let changes = dataStore.getAllChanges();

  if (projectId) {
    changes = changes.filter(c => c.projectId === projectId);
  }
  if (status) {
    changes = changes.filter(c => c.status === status);
  }
  if (category) {
    changes = changes.filter(c => c.category === category);
  }
  if (professional) {
    changes = changes.filter(c => c.professional === professional);
  }

  changes.sort((a, b) => new Date(b.registeredDate).getTime() - new Date(a.registeredDate).getTime());
  const total = changes.length;

  const pageNum = parseInt(page as string, 10);
  const pageSizeNum = parseInt(pageSize as string, 10);
  const start = (pageNum - 1) * pageSizeNum;
  const paged = changes.slice(start, start + pageSizeNum);

  res.json({
    code: 0,
    message: 'success',
    data: paged,
    total,
    page: pageNum,
    pageSize: pageSizeNum,
    totalPages: Math.ceil(total / pageSizeNum),
  });
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const change = dataStore.getChange(id);
  if (!change) {
    res.status(404).json({ code: 404, message: '变更洽商不存在', data: null });
    return;
  }
  res.json({ code: 0, message: 'success', data: change });
});

router.post('/', (req: Request, res: Response) => {
  const body = req.body as Partial<ChangeNegotiation>;

  if (!body.projectId || !body.title || !body.category || !body.professional) {
    res.status(400).json({
      code: 400,
      message: '缺少必要参数：projectId, title, category, professional',
      data: null,
    });
    return;
  }

  const project = dataStore.getProject(body.projectId);
  if (!project) {
    res.status(400).json({ code: 400, message: '所属项目不存在', data: null });
    return;
  }

  const change: ChangeNegotiation = {
    id: dataStore.generateId(),
    projectId: body.projectId,
    code: body.code || `CQ${Date.now()}`,
    title: body.title,
    category: body.category as ChangeCategory,
    professional: body.professional as Professional,
    status: body.status || 'registered',
    registeredDate: body.registeredDate || new Date().toISOString().split('T')[0],
    estimatedAmount: body.estimatedAmount || 0,
    description: body.description || '',
    supervisorOpinion: body.supervisorOpinion,
    supervisorOpinionDate: body.supervisorOpinionDate,
    designOpinion: body.designOpinion,
    designOpinionDate: body.designOpinionDate,
    closedDate: body.closedDate,
    submitter: body.submitter || '',
    attachments: body.attachments || [],
  };

  dataStore.addChange(change);

  if (change.status !== 'registered') {
    dataStore.invalidateRemindersForChange(change.id, change.status);
  }

  res.status(201).json({
    code: 0,
    message: '创建成功',
    data: change,
  });
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body as Partial<ChangeNegotiation>;

  const existing = dataStore.getChange(id);
  if (!existing) {
    res.status(404).json({ code: 404, message: '变更洽商不存在', data: null });
    return;
  }

  const updated = dataStore.updateChange(id, body);
  if (!updated) {
    res.status(500).json({ code: 500, message: '更新失败', data: null });
    return;
  }

  let invalidatedReminders: any[] = [];
  if (body.status && body.status !== existing.status) {
    invalidatedReminders = dataStore.invalidateRemindersForChange(id, body.status as ChangeStatus);
  }

  res.json({
    code: 0,
    message: '更新成功' + (invalidatedReminders.length > 0 ? `，同步作废${invalidatedReminders.length}条对应阶段的超期提醒` : ''),
    data: updated,
    invalidatedReminders,
  });
});

router.post('/:id/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, opinion, date, operator } = req.body;

  if (!status) {
    res.status(400).json({ code: 400, message: '缺少 status 参数', data: null });
    return;
  }

  const existing = dataStore.getChange(id);
  if (!existing) {
    res.status(404).json({ code: 404, message: '变更洽商不存在', data: null });
    return;
  }

  const updates: Partial<ChangeNegotiation> = { status: status as ChangeStatus };
  const statusDate = date || new Date().toISOString().split('T')[0];

  if (status === 'supervisor_review' && opinion) {
    updates.supervisorOpinion = opinion;
    updates.supervisorOpinionDate = statusDate;
  } else if (status === 'design_review' && opinion) {
    updates.designOpinion = opinion;
    updates.designOpinionDate = statusDate;
  } else if (status === 'closed') {
    updates.closedDate = statusDate;
  }

  const updated = dataStore.updateChange(id, updates);
  const invalidated = dataStore.invalidateRemindersForChange(id, status as ChangeStatus);

  res.json({
    code: 0,
    message: `状态变更为【${status}】成功，作废${invalidated.length}条旧阶段提醒`,
    data: updated,
    invalidated,
  });
});

export default router;
