export default function AdvisorLoading() {
  return (
    <div className="rz-route-loading" role="status" aria-live="polite">
      <span className="rz-route-loading-mark" aria-hidden="true">RZ</span>
      <div>
        <strong>正在准备顾问工作区</strong>
        <span>正在载入客户资料与商品数据...</span>
      </div>
    </div>
  );
}
