const Database = require('better-sqlite3');
const db = new Database('alwatan.db');

// جدول المعلمين
db.exec(`
  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    types TEXT NOT NULL
  )
`);

// جدول الحجوزات
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER,
    student_name TEXT NOT NULL,
    lesson_type TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    price INTEGER NOT NULL
  )
`);

// نضيف عمود حالة الحجز لو مش موجود (نشط / تم / ملغي)
try {
  db.exec("ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'active'");
  console.log('تمت إضافة عمود حالة الحجز ✅');
} catch (e) {
  // العمود موجود أصلاً، عادي
}

// جدول الطلاب
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    license_type TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);
// جدول الشكاوى
db.exec(`
  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT DEFAULT 'review',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);
// جدول أوقات تفرغ المعلمين
db.exec(`
  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
  )
`);
// جدول الإشعارات
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);
// نضيف عمود موعد التيست لو مش موجود
try {
  db.exec('ALTER TABLE students ADD COLUMN test_date TEXT');
  console.log('تمت إضافة عمود موعد التيست ✅');
} catch (e) {
  // العمود موجود أصلاً، عادي
}

// نضيف عمود سعر الباقة الكاملة لو مش موجود
try {
  db.exec('ALTER TABLE students ADD COLUMN total_package INTEGER');
  console.log('تمت إضافة عمود سعر الباقة ✅');
} catch (e) {
  // العمود موجود أصلاً، عادي
}

// نضيف عمود كلمة المرور (مشفّرة بـ bcrypt) لو مش موجود
try {
  db.exec('ALTER TABLE students ADD COLUMN password TEXT');
  console.log('تمت إضافة عمود كلمة المرور ✅');
} catch (e) {
  // العمود موجود أصلاً، عادي
}

// جدول الدفعات
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    date TEXT NOT NULL,
    note TEXT
  )
`);

// جدول رواتب الموظفين/المعلمين
db.exec(`
  CREATE TABLE IF NOT EXISTS salaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// جدول طلبات مواعيد الفحص (تؤوريا / تيست) القادمة من الصفحة الرئيسية
db.exec(`
  CREATE TABLE IF NOT EXISTS test_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    kind TEXT NOT NULL,
    preferred_date TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// جدول آراء الطلاب (تحتاج موافقة الإدارة قبل الظهور بالصفحة الرئيسية)
db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const teacherCount = db.prepare('SELECT COUNT(*) as count FROM teachers').get();
if (teacherCount.count === 0) {
  const insertTeacher = db.prepare('INSERT INTO teachers (name, types) VALUES (?, ?)');
  insertTeacher.run('عبد الحكيم غنام', 'automatic,manual,heavy');
  insertTeacher.run('أبو سامح', 'automatic,manual,heavy');
  insertTeacher.run('حسام', 'manual');
  insertTeacher.run('آثار غنام', 'automatic');
  console.log('تمت إضافة المعلمين ✅');
}
// أوقات تفرغ افتراضية (أحد-خميس، 8ص-5م)
const availCount = db.prepare('SELECT COUNT(*) as count FROM availability').get();
if (availCount.count === 0) {
  const insertAvail = db.prepare('INSERT INTO availability (teacher_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)');
  const allTeachers = db.prepare('SELECT id FROM teachers').all();
  allTeachers.forEach(t => {
    for (let day = 0; day <= 4; day++) {
      insertAvail.run(t.id, day, '08:00', '17:00');
    }
  });
  console.log('تمت إضافة أوقات التفرغ ✅');
}

console.log('قاعدة البيانات جاهزة ✅');

module.exports = db;