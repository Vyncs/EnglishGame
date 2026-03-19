import prisma from '../db.js';

function generateCouponCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 7; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function ensureCouponCode(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { couponCode: true } });
  if (user?.couponCode) return user.couponCode;
  let code;
  let exists = true;
  while (exists) {
    code = generateCouponCode();
    exists = !!(await prisma.user.findUnique({ where: { couponCode: code } }));
  }
  await prisma.user.update({ where: { id: userId }, data: { couponCode: code } });
  return code;
}

export async function getDashboard(req, res, next) {
  try {
    const teacherId = req.user.id;
    const couponCode = await ensureCouponCode(teacherId);

    const [totalStudents, totalMaterials, totalAssignments] = await Promise.all([
      prisma.teacherStudent.count({ where: { teacherId } }),
      prisma.teacherMaterial.count({ where: { teacherId } }),
      prisma.materialAssignment.count({
        where: { material: { teacherId } },
      }),
    ]);

    const recentStudents = await prisma.teacherStudent.findMany({
      where: { teacherId },
      take: 5,
      orderBy: { joinedAt: 'desc' },
      include: {
        student: {
          select: { id: true, email: true, name: true, createdAt: true },
        },
      },
    });

    res.json({
      totalStudents,
      totalMaterials,
      totalAssignments,
      couponCode,
      recentStudents: recentStudents.map((ts) => ({
        ...ts.student,
        joinedAt: ts.joinedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
}

export async function getStudents(req, res, next) {
  try {
    const teacherId = req.user.id;
    const { search, page = '1', limit = '20' } = req.query;
    const take = Math.min(parseInt(limit) || 20, 100);
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;

    const where = { teacherId };
    if (search) {
      where.student = {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [records, total] = await Promise.all([
      prisma.teacherStudent.findMany({
        where,
        skip,
        take,
        orderBy: { joinedAt: 'desc' },
        include: {
          student: {
            select: {
              id: true, email: true, name: true, createdAt: true,
              _count: { select: { cards: true, groups: true } },
            },
          },
        },
      }),
      prisma.teacherStudent.count({ where }),
    ]);

    res.json({
      students: records.map((r) => ({
        id: r.student.id,
        email: r.student.email,
        name: r.student.name,
        createdAt: r.student.createdAt,
        joinedAt: r.joinedAt,
        cardsCount: r.student._count.cards,
        groupsCount: r.student._count.groups,
      })),
      total,
      page: Math.max(parseInt(page) || 1, 1),
      totalPages: Math.ceil(total / take),
    });
  } catch (e) {
    next(e);
  }
}

export async function getMaterials(req, res, next) {
  try {
    const teacherId = req.user.id;

    const materials = await prisma.teacherMaterial.findMany({
      where: { teacherId },
      orderBy: { createdAt: 'desc' },
      include: {
        assignments: {
          include: {
            student: { select: { id: true, email: true, name: true } },
          },
        },
      },
    });

    res.json(
      materials.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        type: m.type,
        url: m.url,
        content: m.content,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        assignedStudents: m.assignments.map((a) => ({
          id: a.student.id,
          email: a.student.email,
          name: a.student.name,
          assignedAt: a.assignedAt,
        })),
      }))
    );
  } catch (e) {
    next(e);
  }
}

export async function createMaterial(req, res, next) {
  try {
    const teacherId = req.user.id;
    const { title, description, type, url, content } = req.body;

    if (!title || !type) {
      return res.status(400).json({ error: 'Título e tipo são obrigatórios' });
    }
    if (!['link', 'text', 'video', 'file'].includes(type)) {
      return res.status(400).json({ error: 'Tipo inválido. Use: link, text, video ou file' });
    }

    const material = await prisma.teacherMaterial.create({
      data: { teacherId, title, description, type, url, content },
    });

    res.status(201).json(material);
  } catch (e) {
    next(e);
  }
}

export async function updateMaterial(req, res, next) {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;
    const { title, description, type, url, content } = req.body;

    const existing = await prisma.teacherMaterial.findFirst({
      where: { id, teacherId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Material não encontrado' });
    }

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (type !== undefined) data.type = type;
    if (url !== undefined) data.url = url;
    if (content !== undefined) data.content = content;

    const updated = await prisma.teacherMaterial.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
}

export async function deleteMaterial(req, res, next) {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;

    const existing = await prisma.teacherMaterial.findFirst({
      where: { id, teacherId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Material não encontrado' });
    }

    await prisma.teacherMaterial.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

export async function assignMaterial(req, res, next) {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;
    const { studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds é obrigatório (array)' });
    }

    const material = await prisma.teacherMaterial.findFirst({
      where: { id, teacherId },
    });
    if (!material) {
      return res.status(404).json({ error: 'Material não encontrado' });
    }

    const validStudents = await prisma.teacherStudent.findMany({
      where: { teacherId, studentId: { in: studentIds } },
      select: { studentId: true },
    });
    const validIds = validStudents.map((s) => s.studentId);

    if (validIds.length === 0) {
      return res.status(400).json({ error: 'Nenhum aluno válido encontrado' });
    }

    await prisma.materialAssignment.createMany({
      data: validIds.map((studentId) => ({
        materialId: id,
        studentId,
      })),
      skipDuplicates: true,
    });

    res.json({ assigned: validIds.length });
  } catch (e) {
    next(e);
  }
}

export async function unassignMaterial(req, res, next) {
  try {
    const { id, studentId } = req.params;
    const teacherId = req.user.id;

    const material = await prisma.teacherMaterial.findFirst({
      where: { id, teacherId },
    });
    if (!material) {
      return res.status(404).json({ error: 'Material não encontrado' });
    }

    await prisma.materialAssignment.deleteMany({
      where: { materialId: id, studentId },
    });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
}
