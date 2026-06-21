import { Router, Request, Response } from 'express';
import { dataStore } from '../store/dataStore';
import { ChangeNegotiation, ChangeStatus, ChangeCategory, Professional } from '../types';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { projectId, status, category, professional } = req.query;
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

  res.json({
    code: 0,
    message: 'success',
    data: changes,
    total: changes.length,
  });
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const change = dataStore.getChange(id);
  if (!change) {
    res.status(404).json({
      code: 404,
      message: '变更洽商不存在',
      data: null,
    });
    return;
  }
  res.json({
    code: 0,
    message: 'success',
    data: change,
  });
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
    res.status(400).json({
      code: 400,
      message: '所属项目不存在',
      data: null,
    });
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
    submitter: body.submitter || '',
    attachments: body.attachments || [],
  };

  dataStore.addChange(change);
  res.status(201).json({
    code: 0,
    message: '创建成功',
    data: change,
  });
});

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body as Partial<ChangeNegotiation>;

  const updated = dataStore.updateChange(id, body);
  if (!updated) {
    res.status(404).json({
      code: 404,
      message: '变更洽商不存在',
      data: null,
    });
    return;
  }

  res.json({
    code: 0,
    message: '更新成功',
    data: updated,
  });
});

export default router;
