// Medical MCQ Question Bank (Batch AUC-60)
// Metadata-only file — actual questions are lazy-loaded from questions/*.json

const allSections = [
  {
    "name": "1. سنوات سابقة",
    "dataFile": "questions/past_years_by_exam.json",
    "groupTitle": "أسئلة السنوات السابقة كاملة مقسمة طبقاً لسنة الامتحان",
    "group": "Internal Medicine",
    "exams": [
      { "name": "EM 2021", "questionCount": 30, "uniqueCount": 30, "questions": [] },
      { "name": "ES 2021", "questionCount": 45, "uniqueCount": 45, "questions": [] },
      { "name": "EM 2022", "questionCount": 30, "uniqueCount": 30, "questions": [] },
      { "name": "ES 2022", "questionCount": 45, "uniqueCount": 45, "questions": [] },
      { "name": "EM 2023", "questionCount": 30, "uniqueCount": 30, "questions": [] },
      { "name": "ES 2023", "questionCount": 36, "uniqueCount": 36, "questions": [] },
      { "name": "EM 2024", "questionCount": 28, "uniqueCount": 28, "questions": [] },
      { "name": "ES 2024", "questionCount": 36, "uniqueCount": 36, "questions": [] },
      { "name": "EM 2025", "questionCount": 30, "uniqueCount": 30, "questions": [] },
      { "name": "ES 2025", "questionCount": 36, "uniqueCount": 36, "questions": [] },
      { "name": "EM 2021 (دور ثاني / Reset)", "questionCount": 30, "uniqueCount": 30, "questions": [] },
      { "name": "ES 2021 (دور ثاني / Reset)", "questionCount": 45, "uniqueCount": 45, "questions": [] }
    ]
  },
  {
    "name": "2. سنوات سابقة مقسمة",
    "dataFile": "questions/past_years_by_section.json",
    "groupTitle": "أسئلة السنوات السابقة مقسمة طبقاً للموضوع الطبي",
    "group": "Internal Medicine",
    "exams": [
      { "name": "Cardiology", "questionCount": 129, "uniqueCount": 92, "questions": [] },
      { "name": "Chest", "questionCount": 111, "uniqueCount": 83, "questions": [] },
      { "name": "GIT", "questionCount": 56, "uniqueCount": 50, "questions": [] },
      { "name": "Hepatology", "questionCount": 23, "uniqueCount": 21, "questions": [] },
      { "name": "Blood", "questionCount": 56, "uniqueCount": 44, "questions": [] },
      { "name": "Neuro", "questionCount": 46, "uniqueCount": 37, "questions": [] }
    ]
  },
  {
    "name": "3. ملف القسم",
    "dataFile": "questions/department_file.json",
    "groupTitle": "أسئلة ملف القسم القديم مقسمة طبقاً للموضوع الطبي",
    "group": "Internal Medicine",
    "exams": [
      { "name": "Cardiology", "questionCount": 54, "uniqueCount": 54, "questions": [] },
      { "name": "Chest", "questionCount": 65, "uniqueCount": 64, "questions": [] },
      { "name": "GIT", "questionCount": 23, "uniqueCount": 23, "questions": [] },
      { "name": "Hepatology", "questionCount": 17, "uniqueCount": 17, "questions": [] },
      { "name": "Blood", "questionCount": 8, "uniqueCount": 8, "questions": [] },
      { "name": "Neuro", "questionCount": 37, "uniqueCount": 37, "questions": [] }
    ]
  },
  {
    "name": "4. أسئلة علام",
    "dataFile": "questions/allam_questions.json",
    "groupTitle": "أسئلة دكتور علام مقسمة طبقاً للموضوع الطبي",
    "group": "Internal Medicine",
    "exams": [
      { "name": "Cardiology", "questionCount": 18, "uniqueCount": 18, "questions": [] },
      { "name": "Chest", "questionCount": 11, "uniqueCount": 11, "questions": [] },
      { "name": "Blood", "questionCount": 172, "uniqueCount": 171, "questions": [] },
      { "name": "Neuro", "questionCount": 1, "uniqueCount": 1, "questions": [] }
    ]
  },
  {
    "name": "5. أسئلة المحاضرات",
    "dataFile": "questions/lectures_questions.json",
    "groupTitle": "أسئلة المحاضرات مقسمة طبقاً للموضوع الطبي",
    "group": "Internal Medicine",
    "exams": [
      { "name": "Cardiology", "questionCount": 10, "uniqueCount": 10, "questions": [] },
      { "name": "Chest", "questionCount": 17, "uniqueCount": 17, "questions": [] },
      { "name": "Hepatology", "questionCount": 8, "uniqueCount": 8, "questions": [] }
    ]
  },
  {
    "name": "6. كتاب القسم",
    "dataFile": "questions/textbook_questions.json",
    "groupTitle": "أسئلة كتاب القسم القديم مقسمة طبقاً للموضوع الطبي",
    "group": "Internal Medicine",
    "exams": [
      { "name": "Cardiology", "questionCount": 88, "uniqueCount": 84, "questions": [] },
      { "name": "Chest", "questionCount": 62, "uniqueCount": 61, "questions": [] },
      { "name": "GIT", "questionCount": 35, "uniqueCount": 35, "questions": [] },
      { "name": "Hepatology", "questionCount": 53, "uniqueCount": 53, "questions": [] },
      { "name": "Blood", "questionCount": 196, "uniqueCount": 190, "questions": [] }
    ]
  }
];
