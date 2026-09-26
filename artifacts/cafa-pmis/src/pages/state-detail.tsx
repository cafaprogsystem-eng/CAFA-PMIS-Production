import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useGetState } from "@workspace/api-client-react";
import { ArrowLeft, Building2, FolderKanban, MapPin, Users } from "lucide-react";
import { Card, Skeleton, Table } from "@heroui/react";

export default function StateDetailPage({ params }: { params: { stateId: string } }) {
  const { t, i18n } = useTranslation("planning");
  const stateId = Number(params.stateId);
  const { data, isLoading, isError } = useGetState(stateId, {
    query: {
      enabled: Number.isSafeInteger(stateId) && stateId > 0,
      queryKey: [`/api/states/${stateId}`],
    },
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-56 w-full rounded-xl" /></div>;
  }
  if (isError || !data) {
    return <div className="space-y-4"><Link href="/states" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="me-1 h-4 w-4" />{t("stateDetailPage.backToStates")}</Link><p className="text-destructive">{t("stateDetailPage.loadError")}</p></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/states" className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="me-1 h-4 w-4" />{t("stateDetailPage.backToStates")}</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <MapPin className="h-6 w-6 text-primary" aria-hidden />
              <h1 className="text-3xl font-medium tracking-tight">{i18n.language === "ar" ? data.nameAr || data.name : data.name}</h1>
              <span className="rounded border border-border px-2 py-0.5 font-mono text-sm">{data.code}</span>
            </div>
            <p className="text-sm text-muted-foreground">{t("stateDetailPage.registrySubtitle")}</p>
          </div>
        </div>
      </div>

      <Card>
        <Card.Header><Card.Title className="text-base">{t("stateDetailPage.recordDetails")}</Card.Title></Card.Header>
        <Card.Content>
          <dl className="grid gap-5 sm:grid-cols-5">
            <div><dt className="text-sm text-muted-foreground">{t("stateDetailPage.officeAddress")}</dt><dd className="mt-1 font-medium">{data.officeAddress ?? "—"}</dd></div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("stateDetailPage.manager")}</dt>
              <dd className="mt-1 font-medium">
                {data.officeManagers.length > 0 ? data.officeManagers.map((manager) => manager.name).join(", ") : t("stateDetailPage.noManager")}
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">{t("stateDetailPage.managerReadOnly")}</p>
            </div>
            <div><dt className="text-sm text-muted-foreground">{t("stateDetailPage.localities")}</dt><dd className="mt-1 font-medium">{data.localitiesCount}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t("statesPage.operationalStatus")}</dt><dd className="mt-1 font-medium">{t(`statesPage.status.${data.operationalStatus}`)}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t("statesPage.officeStatus")}</dt><dd className="mt-1 font-medium">{t(`statesPage.office.${data.officeStatus}`)}</dd></div>
          </dl>
        </Card.Content>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Card.Header><Card.Title className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" aria-hidden />{t("stateDetailPage.localities")}</Card.Title></Card.Header>
          <Card.Content>
            {data.localities.length ? <div className="flex flex-wrap gap-2">{data.localities.map((locality) => <span key={locality.id} className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-sm">{locality.name}</span>)}</div> : <p className="text-sm text-muted-foreground">{t("stateDetailPage.noLocalities")}</p>}
          </Card.Content>
        </Card>
        <Card>
          <Card.Header><Card.Title className="flex items-center gap-2 text-base"><Users className="h-4 w-4" aria-hidden />{t("stateDetailPage.referenceSafety")}</Card.Title></Card.Header>
          <Card.Content><p className="text-sm leading-6 text-muted-foreground">{t("stateDetailPage.referenceSafetyDescription")}</p></Card.Content>
        </Card>
      </div>

      <Card>
        <Card.Header><Card.Title className="flex items-center gap-2 text-base"><FolderKanban className="h-4 w-4" aria-hidden />{t("stateDetailPage.linkedProjects")}</Card.Title></Card.Header>
        <Card.Content className="p-0">
          {data.projects.length ? (
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label={t("stateDetailPage.linkedProjects")}>
                  <Table.Header><Table.Column>{t("stateDetailPage.tableCode")}</Table.Column><Table.Column isRowHeader>{t("stateDetailPage.tableTitle")}</Table.Column><Table.Column>{t("stateDetailPage.tableStatus")}</Table.Column><Table.Column>{t("stateDetailPage.tableSector")}</Table.Column></Table.Header>
                  <Table.Body>{data.projects.map((project) => <Table.Row key={project.id} id={project.id}><Table.Cell className="font-mono text-xs"><Link href={`/projects/${project.id}`} className="hover:underline">{project.code}</Link></Table.Cell><Table.Cell className="font-medium"><Link href={`/projects/${project.id}`} className="hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">{project.title}</Link></Table.Cell><Table.Cell>{project.status}</Table.Cell><Table.Cell>{project.sector ?? "—"}</Table.Cell></Table.Row>)}</Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          ) : <p className="p-6 text-sm text-muted-foreground">{t("stateDetailPage.noLinkedProjects")}</p>}
        </Card.Content>
      </Card>
    </div>
  );
}