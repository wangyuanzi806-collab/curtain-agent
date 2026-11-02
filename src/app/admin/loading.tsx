export default function AdminLoading() {
  return (
    <div aria-live="polite" className="rz-route-loading" role="status">
      <span aria-hidden="true" className="rz-route-loading-mark">RZ</span>
      <div>
        <strong>正在准备机构管理</strong>
        <span>正在安全读取团队与业务数据...</span>
      </div>
    </div>
  );
}
