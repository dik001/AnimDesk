import { Compass } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { ActionLink } from "../components/ActionLink";

export default function NotFoundPage() {
  return (
    <div className="grid min-h-[75vh] items-center">
      <EmptyState
        icon={Compass}
        title="404 — страница не найдена"
        description="Возможно, ссылка устарела или в адресе есть ошибка. Вернитесь на главную, чтобы продолжить."
        action={<ActionLink to="/">На главную</ActionLink>}
      />
    </div>
  );
}
