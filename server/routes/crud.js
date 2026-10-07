'use strict';
const { crudRouter } = require('../lib/crud');

module.exports = {
  clubs: crudRouter({
    table: 'clubs', module: 'clubes', order: 'name',
    columns: ['org_id','league_id','name','short_name','logo','city','state','address','district','zip','responsible','phone','email','social','website','founded','status'],
    search: 'name,short_name,city'
  }),
  modalities: crudRouter({
    table: 'modalities', module: 'modalidades', order: 'name',
    columns: ['org_id','name','icon','sport_type','status'], search: 'name'
  }),
  referees: crudRouter({
    table: 'referees', module: 'arbitragem', order: 'name',
    columns: ['org_id','name','role','document','cpf','city','state','phone','email','level','photo','status'],
    search: 'name,city', filters: { role: 'role' }
  }),
  venues: crudRouter({
    table: 'venues', module: 'disputas', order: 'name',
    columns: ['org_id','name','address','city','state','capacity','field_type','photos','contact','availability','status'],
    search: 'name,city'
  }),
  sponsors: crudRouter({
    table: 'sponsors', module: 'financeiro', order: 'company',
    columns: ['org_id','championship_id','company','logo','website','social','contract_value','start_date','end_date','placements','status'],
    search: 'company'
  }),
  news: crudRouter({
    table: 'news', module: 'publicacoes', order: 'publish_date DESC, id DESC',
    columns: ['org_id','championship_id','title','subtitle','content','image','video','category','author','publish_date','status','views'],
    search: 'title,category,author', filters: { status: 'status', category: 'category' }
  }),
  photos: crudRouter({
    table: 'photos', module: 'publicacoes', order: 'id DESC',
    columns: ['org_id','match_id','championship_id','club_id','album','url','caption','shared'],
    search: 'album,caption', filters: { match_id: 'match_id', championship_id: 'championship_id' }
  }),
  videos: crudRouter({
    table: 'videos', module: 'publicacoes', order: 'id DESC',
    columns: ['org_id','championship_id','match_id','title','url','platform','type','thumbnail'],
    search: 'title'
  }),
  streams: crudRouter({
    table: 'streams', module: 'publicacoes', order: 'id DESC',
    columns: ['org_id','match_id','title','url','platform','status','scheduled_at'],
    search: 'title', filters: { match_id: 'match_id' }
  }),
  transactions: crudRouter({
    table: 'transactions', module: 'financeiro', order: 'date DESC, id DESC',
    columns: ['org_id','championship_id','club_id','athlete_id','type','category','description','amount','date','due_date','status','payment_method','document','cost_center'],
    search: 'description,category', filters: { type: 'type', status: 'status', championship_id: 'championship_id' }
  }),
  tickets: crudRouter({
    table: 'tickets', module: 'financeiro', order: 'id DESC',
    columns: ['org_id','match_id','lot','price','quantity','sold','status'],
    search: 'lot', filters: { match_id: 'match_id' }
  })
};
