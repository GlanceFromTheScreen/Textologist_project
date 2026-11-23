"""Exercise the ASGI API including authentication and admin dependencies."""
import asyncio
import json
from urllib.parse import urlencode
from backend import models, utils, dependencies
from backend.main import app
from backend.bootstrap_users import ensure_default_users
from backend.tests.test_comparison_import import ComparisonDatabaseTestCase


class UserManagementTests(ComparisonDatabaseTestCase):
    def setUp(self):
        super().setUp()
        self.user.role = models.UserRole.admin
        self.user.password_hash = utils.get_password_hash('admin-test-password')
        self.other_user.role = models.UserRole.user
        self.other_user.password_hash = utils.get_password_hash('user-test-password')
        self.db.flush()
        app.dependency_overrides[dependencies.get_db] = lambda: self.db
        self.admin_token = self.token(self.user)
        self.user_token = self.token(self.other_user)

    def tearDown(self):
        app.dependency_overrides.clear()
        super().tearDown()

    def token(self, user, **extra):
        return utils.create_access_token({'sub':user.username, 'uid':user.id, 'ver':user.auth_version, 'role':user.role.value, **extra})

    def request(self, method, path, data=None, token=None, form=False):
        async def invoke():
            payload = (urlencode(data).encode() if form else json.dumps(data).encode()) if data is not None else b''
            headers=[(b'content-type', b'application/x-www-form-urlencoded' if form else b'application/json')]
            if token: headers.append((b'authorization',('Bearer '+token).encode()))
            scope=dict(type='http',asgi={'version':'3.0'},http_version='1.1',method=method,scheme='http',path=path,raw_path=path.encode(),query_string=b'',root_path='',headers=headers,client=('127.0.0.1',1),server=('testserver',80))
            messages=[]
            async def receive(): return {'type':'http.request','body':payload,'more_body':False}
            async def send(message): messages.append(message)
            await app(scope,receive,send)
            status=next(m['status'] for m in messages if m['type']=='http.response.start')
            body=b''.join(m.get('body',b'') for m in messages if m['type']=='http.response.body')
            return status,json.loads(body) if body else None
        return asyncio.run(invoke())

    def test_admin_creates_user_and_password_is_never_returned(self):
        name=self.user.username+'-new'
        status,data=self.request('POST','/users/',{'username':name,'password':'new-password'},self.admin_token)
        self.assertEqual(status,201); self.assertEqual(data['role'],'user')
        self.assertNotIn('password',data); self.assertNotIn('password_hash',data)
        status,login=self.request('POST','/auth/login',{'username':name,'password':'new-password'},form=True)
        self.assertEqual(status,200)
        status,profile=self.request('GET','/auth/me',token=login['access_token'])
        self.assertEqual(profile['id'],data['id'])
        status,users=self.request('GET','/users/',token=self.admin_token)
        self.assertEqual(status,200)
        self.assertTrue(all('password_hash' not in user and 'auth_version' not in user for user in users))

    def test_anonymous_and_regular_users_cannot_manage_accounts(self):
        for token,expected in [(None,401),(self.user_token,403),(self.token(self.other_user,role='admin'),403)]:
            for method,path,payload in [('GET','/users/',None),('POST','/users/',{'username':'unauthorized','password':'pw'}),('PATCH',f'/users/{self.other_user.id}',{'password':'new'})]:
                self.assertEqual(self.request(method,path,payload,token)[0],expected)
        self.assertIsNone(self.db.query(models.User).filter_by(username='unauthorized').first())

    def test_rename_and_password_change_revoke_old_sessions_keep_id_and_data(self):
        text=models.TextModel(owner_user_id=self.other_user.id,title='Owned text',source_type=models.SourceType.txt,file_path='',extracted_paragraphs_json=['text'])
        self.db.add(text);self.db.flush()
        old_name=self.other_user.username;new_name=old_name+'-renamed';original_id=self.other_user.id
        status,data=self.request('PATCH',f'/users/{original_id}',{'username':new_name,'password':'updated-password'},self.admin_token)
        self.assertEqual(status,200);self.assertEqual(data['id'],original_id)
        self.assertEqual(self.db.get(models.TextModel,text.id).owner_user_id,original_id)
        self.assertEqual(self.request('GET','/auth/me',token=self.user_token)[0],401)
        self.assertEqual(self.request('GET','/auth/me',token=self.admin_token)[0],200)
        self.assertEqual(self.request('POST','/auth/login',{'username':old_name,'password':'user-test-password'},form=True)[0],401)
        self.assertEqual(self.request('POST','/auth/login',{'username':new_name,'password':'user-test-password'},form=True)[0],401)
        self.assertEqual(self.request('POST','/auth/login',{'username':new_name,'password':'updated-password'},form=True)[0],200)
        # Reusing an old login must never attach its old JWT to a different user.
        self.assertEqual(self.request('POST','/users/',{'username':old_name,'password':'other'},self.admin_token)[0],201)
        self.assertEqual(self.request('GET','/auth/me',token=self.user_token)[0],401)

    def test_login_only_and_password_only_updates(self):
        name=self.other_user.username+'-changed'
        self.assertEqual(self.request('PATCH',f'/users/{self.other_user.id}',{'username':name},self.admin_token)[0],200)
        status,auth=self.request('POST','/auth/login',{'username':name,'password':'user-test-password'},form=True)
        self.assertEqual(status,200)
        self.assertEqual(self.request('PATCH',f'/users/{self.other_user.id}',{'password':'final'},self.admin_token)[0],200)
        self.assertEqual(self.request('GET','/auth/me',token=auth['access_token'])[0],401)
        self.assertEqual(self.request('POST','/auth/login',{'username':name,'password':'final'},form=True)[0],200)

    def test_duplicate_invalid_and_role_injection_are_rejected_atomically(self):
        original_hash=self.other_user.password_hash
        status,_=self.request('PATCH',f'/users/{self.other_user.id}',{'username':self.user.username,'password':'should-not-save'},self.admin_token)
        self.assertEqual(status,409);self.assertEqual(self.other_user.password_hash,original_hash)
        self.assertEqual(self.request('POST','/users/',{'username':self.user.username,'password':'pw'},self.admin_token)[0],409)
        for payload in [{},{'username':''},{'username':' '},{'username':'two words'},{'password':''},{'password':None},{'username':None},{'role':'admin'},{'password':'x'*257}]:
            with self.subTest(payload=payload): self.assertEqual(self.request('PATCH',f'/users/{self.other_user.id}',payload,self.admin_token)[0],422)
        self.assertEqual(self.request('POST','/users/',{'username':'new','password':'pw','role':'admin'},self.admin_token)[0],422)
        self.assertEqual(self.request('PATCH','/users/99999999',{'username':'missing'},self.admin_token)[0],404)
        self.assertEqual(self.request('POST','/auth/register',{'username':'public','password':'pw','role':'user'})[0],403)

    def test_self_edit_preserves_admin_and_requires_new_login(self):
        status,_=self.request('PATCH',f'/users/{self.user.id}',{'password':'admin-updated'},self.admin_token)
        self.assertEqual(status,200)
        self.assertEqual(self.request('GET','/users/',token=self.admin_token)[0],401)
        status,auth=self.request('POST','/auth/login',{'username':self.user.username,'password':'admin-updated'},form=True)
        self.assertEqual(status,200)
        self.assertEqual(self.request('GET','/users/',token=auth['access_token'])[0],200)

    def test_starter_account_edits_survive_bootstrap(self):
        key=self.other_user.username
        self.other_user.bootstrap_key=key;self.db.flush()
        new_name=key+'-managed'
        self.request('PATCH',f'/users/{self.other_user.id}',{'username':new_name,'password':'managed'},self.admin_token)
        ensure_default_users(self.db,((key,'initial',models.UserRole.user),))
        self.assertEqual(self.request('POST','/auth/login',{'username':new_name,'password':'managed'},form=True)[0],200)
        self.assertIsNone(self.db.query(models.User).filter_by(username=key).first())

    def test_legacy_tokens_are_rejected_and_database_role_is_authoritative(self):
        legacy=utils.create_access_token({'sub':self.user.username,'role':'admin'})
        self.assertEqual(self.request('GET','/auth/me',token=legacy)[0],401)
        self.user.role=models.UserRole.user;self.db.flush()
        self.assertEqual(self.request('GET','/users/',token=self.admin_token)[0],403)
