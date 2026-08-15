const express = require('express');
const db = require('./database');
const app = express();
const PORT = 3000;

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
  // نتأكد إذا المعلم محجوز بنفس الوقت
  const conflict = db.prepare(
    'SELECT * FROM bookings WHERE teacher_id = ? AND date = ? AND time = ?'
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
  // ترجع كل الحجوزات
app.get('/api/bookings', (req, res) => {
  const bookings = db.prepare('SELECT * FROM bookings').all();
  res.json(bookings);
});

// إلغاء حجز
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


// تسجيل طالب جديد
app.post('/api/students', (req, res) => {
  const { name, phone, license_type } = req.body;

  // نتأكد إذا الطالب مسجل من قبل
  const existing = db.prepare('SELECT * FROM students WHERE phone = ?').get(phone);
  if (existing) {
    return res.json({ success: false, message: 'هذا الرقم مسجل مسبقاً' });
  }

  const insertStudent = db.prepare('INSERT INTO students (name, phone, license_type) VALUES (?, ?, ?)');
  const result = insertStudent.run(name, phone, license_type);

  res.json({ success: true, studentId: result.lastInsertRowid });
});

// عرض كل الطلاب
app.get('/api/students', (req, res) => {
  const students = db.prepare('SELECT * FROM students').all();
  res.json(students);
});
// تسجيل دخول برقم الموبايل
app.post('/api/login', (req, res) => {
  const { phone } = req.body;

  const student = db.prepare('SELECT * FROM students WHERE phone = ?').get(phone);

  if (!student) {
    return res.json({ success: false, message: 'هذا الرقم غير مسجل' });
  }

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

app.listen(PORT, () => {
  console.log(`السيرفر شغال على http://localhost:${PORT}`);
}); 