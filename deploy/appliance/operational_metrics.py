"""Small, cached operational read model; no person, session or message labels."""
import json
import re
import time


def collect(kc,sql,namespace='lecturer'):
    lines=[]
    def gauge(name,value,labels=''):lines.append(f'lecturer_{name}{labels} {float(value)}')
    pods=json.loads(kc('get','pods','--all-namespaces','-o','json'))['items']
    for category,test in {
        'pending':lambda p:p.get('status',{}).get('phase')=='Pending',
        'unready':lambda p:p.get('metadata',{}).get('namespace')==namespace and p.get('status',{}).get('phase')=='Running' and
            any(not c.get('ready') for c in p.get('status',{}).get('containerStatuses',[])),
        'oom':lambda p:any(c.get('lastState',{}).get('terminated',{}).get('reason')=='OOMKilled' for c in p.get('status',{}).get('containerStatuses',[]))}.items():
        gauge('pods_'+category,sum(1 for p in pods if test(p)))
    quota=json.loads(kc('-n',namespace,'get','resourcequota','application-budget','-o','json'))
    def memory(raw):
        m=re.fullmatch(r'(\d+)(Ki|Mi|Gi)?',raw)
        if not m:raise ValueError('Unexpected memory quantity')
        return int(m[1])*{'Ki':1024,'Mi':1024**2,'Gi':1024**3,None:1}[m[2]]
    for kind in ['used','hard']:gauge('quota_memory_'+kind+'_bytes',memory(quota['status'].get(kind,{}).get('limits.memory','0')))
    # pg_stat values and bounded indexed queue aggregates, on an operator-owned local connection.
    queries={
      'postgres_connections':"select count(*) from pg_stat_activity",
      'postgres_lock_waiters':"select count(*) from pg_stat_activity where wait_event_type='Lock'",
      'postgres_wal_bytes':"select coalesce(sum(size),0) from pg_ls_waldir()",
      'postgres_temp_bytes':"select coalesce(sum(temp_bytes),0) from pg_stat_database",
      'content_jobs_waiting':"select count(*) from content.import_jobs where status in ('PENDING','RUNNING')",
      'content_jobs_failed':"select count(*) from content.import_jobs where status='FAILED'",
      'content_job_oldest_seconds':"select coalesce(extract(epoch from now()-min(created_at)),0) from content.import_jobs where status in ('PENDING','RUNNING')",
      'integration_jobs_dead':"select count(*) from integration.outbox where status='DEAD'",
      'update_needs_attention':"select count(*) from installation.jobs where status='NEEDS_ATTENTION'",
      'blob_usage_bytes':"select bytes from content.storage_budget where singleton"}
    # One SQL round trip and no row payloads or identity data.
    command=' union all '.join(f"select '{name}' as metric,({query})::numeric as value" for name,query in queries.items())
    for row in sql('lecturer',command).splitlines():
        name,value=row.split('|');gauge(name,value)
    for row in sql('analytics',"select 'analytics_jobs_dead',count(*) from report_jobs where dead union all select 'analytics_jobs_waiting',count(*) from report_jobs where not dead").splitlines():
        name,value=row.split('|');gauge(name,value)
    output=kc('-n',namespace,'exec','deployment/core','--','df','-Pk','/data/blobs').decode().splitlines()[-1].split()
    gauge('blob_disk_free_bytes',int(output[3])*1024)
    if any(p.get('metadata',{}).get('namespace')==namespace and
           p.get('metadata',{}).get('labels',{}).get('app.kubernetes.io/component')=='max-adapter' for p in pods):
        # The local command emits aggregate counters only; payload inspection has no HTTP route.
        for row in kc('-n',namespace,'exec','deployment/max-adapter','--','node','/app/inbox-admin.mjs','metrics').decode().splitlines():
            name,value=row.split()
            if not re.fullmatch(r'lecturer_max_inbox_[a-z_]+',name):raise ValueError('Unexpected inbox metric')
            lines.append(f'{name} {float(value)}')
    gauge('operations_collected_seconds',time.time())
    return '\n'.join(lines)+'\n'
