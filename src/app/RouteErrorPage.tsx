import { useRouteError } from "react-router-dom";
import { ErrorState } from "../components/ErrorState";

export function RouteErrorPage() {
  const error = useRouteError();
  console.error("Ошибка экрана AnimDesk", error);
  return (
    <div className="p-10">
      <ErrorState
        title="Не удалось открыть экран"
        message="В приложении произошла ошибка. Перезагрузите окно, чтобы попробовать снова."
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}
