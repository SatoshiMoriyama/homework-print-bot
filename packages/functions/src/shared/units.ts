export interface Unit {
  order: number;
  category: string;
  subcategory: string;
  label: string;
  grade: number;
}

export const MATH_GRADE1_UNITS: Unit[] = [
  // 数と計算
  { order: 1, category: "number_calculation", subcategory: "counting_numbers", label: "かずとすうじ", grade: 1 },
  { order: 2, category: "number_calculation", subcategory: "ordinal_numbers", label: "なんばんめ", grade: 1 },
  { order: 3, category: "number_calculation", subcategory: "composition", label: "いくつといくつ", grade: 1 },
  { order: 4, category: "number_calculation", subcategory: "addition_no_carry", label: "たしざん（くりあがりなし）", grade: 1 },
  { order: 5, category: "number_calculation", subcategory: "subtraction_no_borrow", label: "ひきざん（くりさがりなし）", grade: 1 },
  { order: 6, category: "number_calculation", subcategory: "addition_with_carry", label: "たしざん（くりあがりあり）", grade: 1 },
  { order: 7, category: "number_calculation", subcategory: "subtraction_with_borrow", label: "ひきざん（くりさがりあり）", grade: 1 },
  { order: 8, category: "number_calculation", subcategory: "three_numbers", label: "3つのかずのけいさん", grade: 1 },
  { order: 9, category: "number_calculation", subcategory: "numbers_over_20", label: "20よりおおきいかず", grade: 1 },
  // 図形
  { order: 10, category: "shape", subcategory: "shape_play", label: "かたちあそび", grade: 1 },
  { order: 11, category: "shape", subcategory: "shape_building", label: "かたちづくり", grade: 1 },
  // 測定
  { order: 12, category: "measurement", subcategory: "length_compare", label: "ながさくらべ", grade: 1 },
  { order: 13, category: "measurement", subcategory: "area_compare", label: "ひろさくらべ", grade: 1 },
  { order: 14, category: "measurement", subcategory: "volume_compare", label: "かさくらべ", grade: 1 },
  // 時計
  { order: 15, category: "clock", subcategory: "hour_half", label: "なんじ なんじはん", grade: 1 },
  // データ
  { order: 16, category: "data", subcategory: "counting_survey", label: "ものの数しらべ", grade: 1 },
  // 文章題
  { order: 17, category: "word_problem", subcategory: "addition_word", label: "たしざんの文章題", grade: 1 },
  { order: 18, category: "word_problem", subcategory: "subtraction_word", label: "ひきざんの文章題", grade: 1 },
];

export function getUnitByOrder(order: number, grade: number = 1): Unit | undefined {
  return MATH_GRADE1_UNITS.find((u) => u.order === order && u.grade === grade);
}

export function getUnitBySubcategory(subcategory: string): Unit | undefined {
  return MATH_GRADE1_UNITS.find((u) => u.subcategory === subcategory);
}

export function getNextUnit(currentOrder: number, grade: number = 1): Unit | undefined {
  return MATH_GRADE1_UNITS.find((u) => u.order === currentOrder + 1 && u.grade === grade);
}

export function getUnitsByCategory(category: string): Unit[] {
  return MATH_GRADE1_UNITS.filter((u) => u.category === category);
}

export function getTotalUnits(grade: number = 1): number {
  return MATH_GRADE1_UNITS.filter((u) => u.grade === grade).length;
}
