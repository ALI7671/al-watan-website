//redeploy trigger
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./database');
const app = express();
const PORT = 3000;
const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 6;

// هاد السطر يخلي السيرفر يفهم بيانات JSON يلي بتوصله
app.use(express.json());

app.use(express.static('public'));


// ترجع كل المعلمين
app.get('/api/teachers', (req, res) => {
  const teachers = db.prepare('SELECT * FROM teachers').all();
  res.json(teachers);
});

// إنشاء حجز جديد
app.post('/api/bookings', (req, res) => {
  const { teacher_id, student_name, lesson_type, date, time } = req.body;
  // نتأكد إذا المعلم محجوز بنفس الوقت (نتجاهل الحجوزات الملغاة)
  const conflict = db.prepare(
    "SELECT * FROM bookings WHERE teacher_id = ? AND date = ? AND time = ? AND status != 'cancelled'"
  ).get(teacher_id, date, time);

  if (conflict) {
    return res.json({ success: false, message: 'هذا المعلم محجوز بهذا الموعد، اختر وقت ثاني' });
  }

  // نحدد السعر حسب نوع الدرس
  const price = lesson_type === 'heavy' ? 130 : 110;

  const insertBooking = db.prepare(`
    INSERT INTO bookings (teacher_id, student_name, lesson_type, date, time, price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = insertBooking.run(teacher_id, student_name, lesson_type, date, time, price);

  res.json({ success: true, bookingId: result.lastInsertRowid, price });
});
  // ترجع كل الحجوزات (مع اسم المعلم)
app.get('/api/bookings', (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, t.name AS teacher_name
    FROM bookings b
    LEFT JOIN teachers t ON b.teacher_id = t.id
    ORDER BY b.date DESC, b.time DESC
  `).all();
  res.json(bookings);
});

// تعديل حجز (المعلم، التاريخ، الوقت) - للإدارة
app.put('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { teacher_id, date, time } = req.body;

  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) {
    return res.json({ success: false, message: 'هذا الحجز غير موجود' });
  }

  const conflict = db.prepare(
    "SELECT * FROM bookings WHERE teacher_id = ? AND date = ? AND time = ? AND status != 'cancelled' AND id != ?"
  ).get(teacher_id, date, time, id);

  if (conflict) {
    return res.json({ success: false, message: 'هذا المعلم محجوز بهذا الموعد، اختر وقت ثاني' });
  }

  db.prepare('UPDATE bookings SET teacher_id = ?, date = ?, time = ? WHERE id = ?').run(teacher_id, date, time, id);
  res.json({ success: true });
});

// تحديث حالة الحجز (نشط / تم / ملغي) - للإدارة
app.put('/api/bookings/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'done', 'cancelled'].includes(status)) {
    return res.json({ success: false, message: 'حالة غير صالحة' });
  }

  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true });
});

// إلغاء حجز (حذف نهائي - يستخدمه الطالب من حسابه)
app.delete('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  res.json({ success: true });
});

// حجوزات طالب معين (بالاسم)
app.get('/api/bookings/student/:name', (req, res) => {
  const { name } = req.params;
  const bookings = db.prepare('SELECT * FROM bookings WHERE student_name = ?').all(name);
  res.json(bookings);
});


// تسجيل طالب جديد (مع كلمة مرور مشفّرة)
app.post('/api/students', async (req, res) => {
  const { name, phone, license_type, password } = req.body;

  if (!name || !phone || !license_type || !password) {
    return res.json({ success: false, message: 'يرجى تعبئة جميع الحقول' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.json({ success: false, message: `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل` });
  }

  // نتأكد إذا الطالب مسجل من قبل
  const existing = db.prepare('SELECT * FROM students WHERE phone = ?').get(phone);
  if (existing) {
    return res.json({ success: false, message: 'هذا الرقم مسجل مسبقاً. إذا كان حسابك قديم وما عندك كلمة مرور، سجّل الدخول وبينطلب منك تنشئ وحدة' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const insertStudent = db.prepare('INSERT INTO students (name, phone, license_type, password) VALUES (?, ?, ?, ?)');
  const result = insertStudent.run(name, phone, license_type, passwordHash);

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid);
  delete student.password;

  res.json({ success: true, student });
});

// عرض كل الطلاب (مع عدد الدروس والمدفوعات والباقي على كل طالب)
app.get('/api/students', (req, res) => {
  const students = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM bookings b WHERE b.student_name = s.name AND b.status = 'done') AS lessons_taken,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id), 0) AS total_paid,
      (COALESCE(s.total_package, 0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id), 0)) AS remaining
    FROM students s
  `).all();
  students.forEach(s => delete s.password);
  res.json(students);
});
// بيانات طالب واحد (مع سعر المقاولة والمدفوع والباقي) - تستخدم بحساب الطالب
app.get('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const student = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM bookings b WHERE b.student_name = s.name AND b.status = 'done') AS lessons_taken,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id), 0) AS total_paid,
      (COALESCE(s.total_package, 0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id), 0)) AS remaining
    FROM students s WHERE s.id = ?
  `).get(id);

  if (!student) {
    return res.json({ success: false, message: 'هذا الطالب غير موجود' });
  }
  delete student.password;

  res.json({ success: true, student });
});

// تسجيل دخول برقم الموبايل وكلمة المرور
app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;

  const student = db.prepare('SELECT * FROM students WHERE phone = ?').get(phone);

  if (!student) {
    return res.json({ success: false, message: 'هذا الرقم غير مسجل' });
  }

  // طالب قديم ما إله كلمة مرور بعد - لازم ينشئ وحدة قبل ما يكمل
  if (!student.password) {
    return res.json({ success: false, needsPasswordSetup: true, message: 'هذا أول تسجيل دخول لك، يرجى إنشاء كلمة مرور' });
  }

  if (!password) {
    return res.json({ success: false, message: 'يرجى إدخال كلمة المرور' });
  }

  const match = await bcrypt.compare(password, student.password);
  if (!match) {
    return res.json({ success: false, message: 'رقم الموبايل أو كلمة المرور غير صحيحة' });
  }

  delete student.password;
  res.json({ success: true, student });
});

// إنشاء كلمة مرور لطالب قديم بيسجل دخول لأول مرة بدون كلمة مرور
app.post('/api/set-password', async (req, res) => {
  const { phone, password, confirmPassword } = req.body;

  const student = db.prepare('SELECT * FROM students WHERE phone = ?').get(phone);
  if (!student) {
    return res.json({ success: false, message: 'هذا الرقم غير مسجل' });
  }
  if (student.password) {
    return res.json({ success: false, message: 'هذا الحساب إله كلمة مرور مسبقاً' });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.json({ success: false, message: `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل` });
  }
  if (password !== confirmPassword) {
    return res.json({ success: false, message: 'كلمتا المرور غير متطابقتين' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare('UPDATE students SET password = ? WHERE id = ?').run(passwordHash, student.id);

  delete student.password;
  res.json({ success: true, student });
});
// إرسال شكوى
app.post('/api/complaints', (req, res) => {
  const { student_name, subject, body } = req.body;
  const insert = db.prepare('INSERT INTO complaints (student_name, subject, body) VALUES (?, ?, ?)');
  const result = insert.run(student_name, subject, body);
  res.json({ success: true, complaintId: result.lastInsertRowid });
});

// عرض كل الشكاوى
app.get('/api/complaints', (req, res) => {
  const complaints = db.prepare('SELECT * FROM complaints ORDER BY id DESC').all();
  res.json(complaints);
});

// شكاوى طالب معين
app.get('/api/complaints/student/:name', (req, res) => {
  const { name } = req.params;
  const complaints = db.prepare('SELECT * FROM complaints WHERE student_name = ? ORDER BY id DESC').all(name);
  res.json(complaints);
});
// تحديث حالة شكوى (رد الإدارة)
app.put('/api/complaints/:id', (req, res) => {
  const { id } = req.params;
  db.prepare("UPDATE complaints SET status = 'answered' WHERE id = ?").run(id);
  res.json({ success: true });
});
// أوقات تفرغ معلم معين
app.get('/api/availability/:teacherId', (req, res) => {
  const { teacherId } = req.params;
  const slots = db.prepare('SELECT * FROM availability WHERE teacher_id = ? ORDER BY day_of_week').all(teacherId);
  res.json(slots);
});

// كل أوقات التفرغ (للإدارة)
app.get('/api/availability', (req, res) => {
  const slots = db.prepare(`
    SELECT a.*, t.name as teacher_name
    FROM availability a
    JOIN teachers t ON a.teacher_id = t.id
    ORDER BY a.teacher_id, a.day_of_week
  `).all();
  res.json(slots);
});

// تحديث أوقات تفرغ معلم (الإدارة)
app.put('/api/availability/:teacherId', (req, res) => {
  const { teacherId } = req.params;
  const { slots } = req.body;

  // نمسح القديم
  db.prepare('DELETE FROM availability WHERE teacher_id = ?').run(teacherId);

  // نضيف الجديد
  const insert = db.prepare('INSERT INTO availability (teacher_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)');
  slots.forEach(s => insert.run(teacherId, s.day_of_week, s.start_time, s.end_time));

  res.json({ success: true });
});
// إشعارات طالب معين
app.get('/api/notifications/:name', (req, res) => {
  const { name } = req.params;
  const notifs = db.prepare('SELECT * FROM notifications WHERE student_name = ? ORDER BY id DESC').all(name);
  res.json(notifs);
});

// إنشاء إشعار (الإدارة)
app.post('/api/notifications', (req, res) => {
  const { student_name, message } = req.body;
  const insert = db.prepare('INSERT INTO notifications (student_name, message) VALUES (?, ?)');
  insert.run(student_name, message);
  res.json({ success: true });
});

// تعليم إشعار كمقروء
app.put('/api/notifications/:id/read', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

// تحديث موعد التيست لطالب
app.put('/api/students/:id/test-date', (req, res) => {
  const { id } = req.params;
  const { test_date } = req.body;

  db.prepare('UPDATE students SET test_date = ? WHERE id = ?').run(test_date, id);

  // نبعت إشعار للطالب
  const student = db.prepare('SELECT name FROM students WHERE id = ?').get(id);
  if (student) {
    db.prepare('INSERT INTO notifications (student_name, message) VALUES (?, ?)')
      .run(student.name, `تم تحديد موعد التيست تبعك: ${test_date}`);
  }

  res.json({ success: true });
});

// تسجيل دفعة جديدة لطالب
app.post('/api/payments', (req, res) => {
  const { student_id, amount, date, note } = req.body;

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(student_id);
  if (!student) {
    return res.json({ success: false, message: 'هذا الطالب غير موجود' });
  }

  const insert = db.prepare('INSERT INTO payments (student_id, amount, date, note) VALUES (?, ?, ?, ?)');
  const result = insert.run(student_id, amount, date, note || null);

  res.json({ success: true, paymentId: result.lastInsertRowid });
});

// عرض دفعات طالب معين
app.get('/api/payments/:studentId', (req, res) => {
  const { studentId } = req.params;
  const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY date DESC, id DESC').all(studentId);
  res.json(payments);
});

// تحديث سعر باقة الطالب
app.put('/api/students/:id/package', (req, res) => {
  const { id } = req.params;
  const { total_package } = req.body;
  db.prepare('UPDATE students SET total_package = ? WHERE id = ?').run(total_package, id);
  res.json({ success: true });
});

// ===== رواتب الموظفين/المعلمين =====

// عرض كل الرواتب
app.get('/api/salaries', (req, res) => {
  const salaries = db.prepare('SELECT * FROM salaries ORDER BY id DESC').all();
  res.json(salaries);
});

// إضافة راتب جديد
app.post('/api/salaries', (req, res) => {
  const { name, amount } = req.body;
  if (!name || !amount || amount <= 0) {
    return res.json({ success: false, message: 'يرجى تعبئة الاسم والمبلغ بشكل صحيح' });
  }
  const insert = db.prepare('INSERT INTO salaries (name, amount) VALUES (?, ?)');
  const result = insert.run(name, amount);
  res.json({ success: true, salaryId: result.lastInsertRowid });
});

// تعديل راتب
app.put('/api/salaries/:id', (req, res) => {
  const { id } = req.params;
  const { name, amount } = req.body;
  if (!name || !amount || amount <= 0) {
    return res.json({ success: false, message: 'يرجى تعبئة الاسم والمبلغ بشكل صحيح' });
  }
  db.prepare('UPDATE salaries SET name = ?, amount = ? WHERE id = ?').run(name, amount, id);
  res.json({ success: true });
});

// حذف راتب
app.delete('/api/salaries/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM salaries WHERE id = ?').run(id);
  res.json({ success: true });
});

// إنشاء طلب موعد فحص (تؤوريا أو تيست) من الصفحة الرئيسية
app.post('/api/test-requests', (req, res) => {
  const { name, phone, kind, preferred_date } = req.body;

  if (!name || !phone || !kind) {
    return res.json({ success: false, message: 'يرجى تعبئة الاسم ورقم الموبايل' });
  }

  const insert = db.prepare(
    'INSERT INTO test_requests (name, phone, kind, preferred_date) VALUES (?, ?, ?, ?)'
  );
  const result = insert.run(name, phone, kind, preferred_date || null);

  res.json({ success: true, requestId: result.lastInsertRowid });
});

// عرض كل طلبات مواعيد الفحص (للإدارة)
app.get('/api/test-requests', (req, res) => {
  const requests = db.prepare('SELECT * FROM test_requests ORDER BY id DESC').all();
  res.json(requests);
});

// تحديث حالة طلب موعد فحص (تم التواصل)
app.put('/api/test-requests/:id', (req, res) => {
  const { id } = req.params;
  db.prepare("UPDATE test_requests SET status = 'done' WHERE id = ?").run(id);
  res.json({ success: true });
});

// ===== آراء الطلاب (Reviews) =====

// إرسال رأي جديد من طالب (يبقى قيد المراجعة لحد ما الإدارة توافق عليه)
app.post('/api/reviews', (req, res) => {
  const { student_name, rating, text } = req.body;
  const ratingNum = parseInt(rating, 10);

  if (!student_name || !text || !text.trim()) {
    return res.json({ success: false, message: 'يرجى كتابة رأيك قبل الإرسال' });
  }
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.json({ success: false, message: 'يرجى اختيار تقييم من 1 إلى 5 نجوم' });
  }

  const insert = db.prepare('INSERT INTO reviews (student_name, rating, text) VALUES (?, ?, ?)');
  const result = insert.run(student_name, ratingNum, text.trim());

  res.json({ success: true, reviewId: result.lastInsertRowid });
});

// عرض كل الآراء (للإدارة)
app.get('/api/reviews', (req, res) => {
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY id DESC').all();
  res.json(reviews);
});

// عرض الآراء الموافق عليها فقط (للصفحة الرئيسية)
app.get('/api/reviews/approved', (req, res) => {
  const reviews = db.prepare("SELECT * FROM reviews WHERE status = 'approved' ORDER BY id DESC").all();
  res.json(reviews);
});

// نشر (الموافقة على) رأي طالب
app.put('/api/reviews/:id/approve', (req, res) => {
  const { id } = req.params;
  db.prepare("UPDATE reviews SET status = 'approved' WHERE id = ?").run(id);
  res.json({ success: true });
});

// حذف رأي
app.delete('/api/reviews/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`السيرفر شغال على http://localhost:${PORT}`);
}); 