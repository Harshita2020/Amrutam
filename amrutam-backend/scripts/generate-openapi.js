import { writeFileSync } from 'node:fs';
const string = (extra = {}) => ({ type:'string', ...extra });
const uuid = string({ format:'uuid' });
const date = string({ format:'date-time' });
const enumeration = (...values) => string({ enum:values });
const object = (properties,required=Object.keys(properties)) => ({type:'object',properties,...(required.length?{required}:{}),additionalProperties:false});
const page = [query('limit',{type:'integer',minimum:1,maximum:50,default:20}),query('offset',{type:'integer',minimum:0,maximum:10000,default:0})];
function query(name,schema) {return {name,in:'query',schema};}
const key = {name:'Idempotency-Key',in:'header',required:true,schema:string({minLength:1,maxLength:200})};
const error = {description:'Request rejected; see error code',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}};
const paths = {};
function route(method,path,summary,{body,params=[],publicAccess=false,status=200,description='',response}={}) {
  const ids = [...path.matchAll(/\{([^}]+)\}/g)].map(match=>({name:match[1],in:'path',required:true,schema:uuid}));
  paths[path] ??= {};
  paths[path][method] = {summary,description,operationId:method+path.replace(/[^a-zA-Z0-9]/g,'_'),
    tags:[path.split('/')[1]],security:publicAccess?[]:[{bearerAuth:[]}],parameters:[...ids,...params],
    ...(body?{requestBody:{required:true,content:{'application/json':{schema:body}}}}:{}),
    responses:{[status]:{description:'Success',content:{'application/json':{schema:response??{$ref:'#/components/schemas/Success'}}}},
      ...Object.fromEntries([400,401,403,404,409,413,429,500,503].map(code=>[code,error]))}};
}
const login = object({email:string({format:'email'}),password:string({minLength:1,maxLength:72}),code:string({pattern:'^[0-9]{6}$'}),recoveryCode:string({pattern:'^[a-f0-9]{32}$'})},['email','password']);
route('get','/health','Process liveness',{publicAccess:true,response:object({status:enumeration('ok'),service:string()})});
route('get','/health/ready','PostgreSQL readiness',{publicAccess:true,response:object({status:enumeration('ready'),database:enumeration('connected')})});
route('post','/auth/register','Register patient or doctor',{publicAccess:true,status:201,body:object({email:string({format:'email'}),password:string({minLength:12,maxLength:72}),role:enumeration('patient','doctor')}),description:'Passwords are also limited to 72 UTF-8 bytes. Registration does not issue a token.'});
route('post','/auth/login','Login with password and enrolled MFA',{publicAccess:true,body:login,description:'Enrolled users must supply one unused TOTP or recoveryCode. Access-token expiry defaults to 900 seconds. Passwords are limited to 72 UTF-8 bytes.'});
route('get','/auth/me','Get safe current identity');
route('post','/auth/mfa/enroll','Start authenticator enrollment',{body:object({password:string({maxLength:72})}),description:'Returns secret and otpauthUri once for setup. Enrollment expires in 10 minutes. Requires current password. MFA encryption key must be configured.'});
route('post','/auth/mfa/confirm','Confirm authenticator enrollment',{body:object({code:string({pattern:'^[0-9]{6}$'})}),description:'Returns eight single-use recovery codes. Invalidates existing tokens. Log in again with a new TOTP or recovery code.'});
route('post','/auth/logout-all','Revoke all current access tokens');
route('patch','/users/me','Update patient profile',{body:object({fullName:string({minLength:1,maxLength:120}),phone:string({maxLength:30,nullable:true})},['fullName'])});
const doctorProfile=object({fullName:string({minLength:1,maxLength:120}),specialty:string({minLength:1,maxLength:100}),specialization:string({minLength:1,maxLength:100}),bio:string({maxLength:1000,nullable:true})},[]);
route('get','/doctors','Search active approved doctors',{publicAccess:true,params:[query('q',string({maxLength:100})),query('specialty',string({maxLength:100})),query('specialization',string({maxLength:100})),query('limit',{type:'integer',minimum:1,maximum:50,default:10}),query('cursor',string())]});
route('patch','/doctors/me','Create or update own doctor profile',{body:doctorProfile,description:'Doctor only. At least one field required; initial creation needs fullName and specialty/specialization. Approval fields cannot be self-edited.'});
route('get','/doctors/{doctorId}','Read approved doctor profile',{publicAccess:true});
route('get','/doctors/{doctorId}/slots','List future available slots',{publicAccess:true,params:[query('from',date),query('to',date),query('limit',{type:'integer',minimum:1,maximum:100,default:50})]});
route('post','/doctors/me/slots','Create future availability',{status:201,body:object({startsAt:date,endsAt:date}),description:'Doctor only. End must follow start; doctor lock serializes overlap checks.'});
route('patch','/doctors/me/slots/{slotId}','Update own availability',{body:object({startsAt:date,endsAt:date,status:enumeration('available','unavailable')},[]),description:'At least one field. Booked slots cannot change; consultation-referenced times are immutable.'});
route('delete','/doctors/me/slots/{slotId}','Delete own unbooked unreferenced slot');
route('post','/bookings','Book a doctor slot',{status:201,body:object({slotId:uuid}),params:[{...key,required:false}],description:'Patient only. Keys are scoped to patient and retained with the consultation; identical retries replay original creation response even after cancellation. Without a key, duplicates return a slot conflict.'});
route('get','/bookings/me','List own patient bookings',{params:[query('status',enumeration('scheduled','in_progress','completed','cancelled')),query('from',date),query('to',date),query('limit',{type:'integer',minimum:1,maximum:50,default:10}),query('cursor',string())]});
route('get','/bookings/{bookingId}','Read authorized booking');
route('post','/bookings/{bookingId}/cancel','Cancel scheduled booking',{body:object({reason:string({minLength:1,maxLength:500})},[]),description:'Owner patient, assigned doctor, or admin. Optional body. Repeated cancellation returns 409. Future slots are released; elapsed slots become unavailable.'});
paths['/bookings/{bookingId}/cancel'].post.requestBody.required=false;
route('get','/consultations/me','List own patient or doctor consultations',{params:[...page,query('status',enumeration('scheduled','in_progress','completed','cancelled'))],description:'Doctors require MFA. Admins use analytics or authorized detail endpoints.'});
route('get','/consultations/{id}','Read consultation',{description:'Owning patient, assigned doctor or admin. Doctor/admin must be MFA authenticated. Reads are audited.'});
route('patch','/consultations/{id}/status','Transition assigned consultation',{body:object({status:enumeration('in_progress','completed')}),description:'Assigned approved doctor with MFA. scheduled → in_progress → completed. Repeating current state is idempotent. Cancellation uses booking endpoint.'});
route('post','/consultations/{id}/prescriptions','Create immutable prescription',{status:201,params:[key],body:object({items:{type:'array',minItems:1,maxItems:30,items:object({medicationName:string({minLength:1,maxLength:200}),instructions:string({minLength:1,maxLength:1000}),quantity:{type:'integer',minimum:1,maximum:10000}})},notes:string({maxLength:2000})},['items']),description:'Assigned approved doctor with MFA. Consultation must be in_progress or completed. Idempotency-Key is required and scoped to doctor; changed payload returns 409.'});
route('get','/consultations/{id}/prescriptions','Read authorized prescriptions',{params:page,description:'Owner patient, assigned doctor or admin; doctor/admin require MFA. Reads are audited.'});
route('get','/admin/analytics','Aggregate consultations by creation date',{params:[query('from',date),query('to',date)],description:'Admin plus MFA. Default last 30 days, maximum 366-day range. No identifiable patient details.'});
route('patch','/admin/doctors/{id}/verification','Approve/reject doctor profile',{body:object({status:enumeration('pending','approved','rejected')}),description:'Admin plus MFA. Audited; repeated status assignment has same resource outcome.'});
route('get','/admin/audit-logs','Read bounded audit history',{params:[query('limit',{type:'integer',minimum:1,maximum:100,default:20}),query('before',string({pattern:'^[0-9]{1,19}$'}))],description:'Admin plus MFA. Descending ID cursor is returned as nextCursor; pass it as before.'});
route('get','/admin/metrics','Prometheus metrics',{description:'Admin plus MFA; configure an authenticated scraper and refresh access tokens.'});
paths['/admin/metrics'].get.responses[200]={description:'Prometheus exposition',content:{'text/plain':{schema:string()}}};
const document={openapi:'3.0.3',info:{title:'Amrutam Telemedicine API',version:'1.0.0',description:'Submission implementation. Clinical doctor/admin operations require MFA. Payment provider integration is not configured; no payment mutation API is exposed.'},servers:[{url:'/api/v1'}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'}},schemas:{Error:object({error:object({code:string(),message:string()})}),Success:{type:'object',properties:{data:{oneOf:[{type:'object',additionalProperties:true},{type:'array',items:{type:'object',additionalProperties:true}}]},pagination:{type:'object',additionalProperties:true}}}}}};
writeFileSync(new URL('../openapi.json',import.meta.url),JSON.stringify(document,null,2)+'\n');
console.log(`Generated OpenAPI for ${Object.keys(paths).length} paths.`);
