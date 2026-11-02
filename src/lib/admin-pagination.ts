export const ADMIN_PAGE_SIZES = {
  fabrics: 12,
  // 商品要按标签筛，就得先全部在手上：分页取 10 条再筛，
  // 点「棉麻」只会在这 10 条里筛，而库里有 985 款。
  skus: 1000,
  knowledge: 8,
  history: 12,
} as const;

export type AdminDataPage<T> = {
  items: T[];
  hasMore: boolean;
  nextOffset: number;
};
