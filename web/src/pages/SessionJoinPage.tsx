import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getLiveSession } from "../app/api/live-api";
import { getChannelConfig } from "../app/api/config-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { LocalQrCode } from "../widgets/LocalQrCode";

interface SessionJoinPageProps {
  courseId: string;
  sessionId: string;
}

export function SessionJoinPage({ courseId, sessionId }: SessionJoinPageProps) {
  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId)
  });
  const channelQuery = useQuery({
    queryKey: ["config", "channels"],
    queryFn: getChannelConfig
  });

  const code = sessionQuery.data?.joinCode ?? "";
  const webUrl = useMemo(() => {
    if (!code) return "";
    return `${window.location.origin}${window.location.pathname}#/s/${code}`;
  }, [code]);
  const telegramBot = channelQuery.data?.telegramBot ?? null;
  const vkBot = channelQuery.data?.vkBot ?? null;
  const telegramUrl = telegramBot ? `https://t.me/${telegramBot}?start=${code}` : null;
  const vkUrl = vkBot ? `https://vk.com/${vkBot}` : null;

  if (sessionQuery.isLoading) {
    return (
      <main className="session-join-shell session-join-shell--center">
        <Loader2 className="student-spinner" size={24} />
        Загрузка кода подключения…
      </main>
    );
  }

  if (sessionQuery.isError || !code) {
    return (
      <main className="session-join-shell session-join-shell--center">
        <h1>Сессия не найдена</h1>
        <p className="muted">Окно подключения открывается из режима лектора.</p>
      </main>
    );
  }

  return (
    <main className="session-join-shell">
      <header className="session-join-head">
        <span className="muted">Подключение к лекции</span>
        <strong className="session-join-code">{code}</strong>
        <small className="muted">Перетащите окно на второй экран — оно живёт отдельно от презентера.</small>
      </header>

      <Tabs defaultValue="web" className="session-join-tabs">
        <TabsList className="session-join-tabs__list">
          <TabsTrigger value="web">Веб</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
          <TabsTrigger value="vk">ВКонтакте</TabsTrigger>
        </TabsList>

        <TabsContent value="web" className="session-join-panel">
          <JoinTarget
            qr={webUrl}
            link={webUrl}
            hint="Камера телефона → откроется страница лекции, вход без приложения."
          />
        </TabsContent>

        <TabsContent value="telegram" className="session-join-panel">
          {telegramUrl ? (
            <JoinTarget
              qr={telegramUrl}
              link={telegramUrl}
              hint={`Откроется бот @${telegramBot}, код подставится автоматически.`}
            />
          ) : (
            <ChannelSoon name="Telegram" />
          )}
        </TabsContent>

        <TabsContent value="vk" className="session-join-panel">
          {vkUrl ? (
            <JoinTarget qr={vkUrl} link={vkUrl} hint="Откроется сообщество во ВКонтакте." />
          ) : (
            <ChannelSoon name="ВКонтакте" />
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function JoinTarget({ qr, link, hint }: { qr: string; link: string; hint: string }) {
  return (
    <div className="session-join-target">
      <LocalQrCode value={qr} label="Наведите камеру" />
      <a className="session-join-link" href={link} target="_blank" rel="noreferrer">
        {link}
      </a>
      <p className="muted">{hint}</p>
    </div>
  );
}

function ChannelSoon({ name }: { name: string }) {
  return (
    <div className="session-join-soon">
      <strong>{name} скоро подключим</strong>
      <p className="muted">
        Канал ещё не настроен на этом сервере. Пока используйте веб-вход — он работает без
        приложения.
      </p>
    </div>
  );
}
