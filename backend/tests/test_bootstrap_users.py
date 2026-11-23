import os
import secrets
from unittest.mock import patch
from fastapi.security import OAuth2PasswordRequestForm
from backend import models, utils
from backend.bootstrap_users import DEFAULT_USERS, configured_default_users, ensure_default_users
from backend.routers.auth import login
from backend.tests.test_comparison_import import ComparisonDatabaseTestCase


class DefaultUsersTests(ComparisonDatabaseTestCase):
    def accounts(self):
        return tuple((self.user.username + '-' + name, secrets.token_urlsafe(20), role) for name, _, role in DEFAULT_USERS)

    def test_creates_three_accounts_with_working_passwords_and_roles(self):
        accounts = self.accounts()
        ensure_default_users(self.db, accounts)
        for username, password, role in accounts:
            user = self.db.query(models.User).filter_by(username=username).one()
            self.assertEqual(user.role, role)
            self.assertNotEqual(user.password_hash, password)
            self.assertTrue(utils.verify_password(password, user.password_hash))
            token = login(OAuth2PasswordRequestForm(username=username, password=password), self.db)
            self.assertEqual(token['token_type'], 'bearer')
            self.assertTrue(token['access_token'])

    def test_repeated_bootstrap_keeps_ids_hashes_and_unrelated_users(self):
        accounts = self.accounts()
        ensure_default_users(self.db, accounts)
        names = [a[0] for a in accounts]
        before = {u.id: u.password_hash for u in self.db.query(models.User).filter(models.User.username.in_(names)).all()}
        ensure_default_users(self.db, accounts)
        after = {u.id: u.password_hash for u in self.db.query(models.User).filter(models.User.username.in_(names)).all()}
        self.assertEqual(before, after)
        self.assertEqual(len(after), 3)
        self.assertEqual(self.db.get(models.User, self.other_user.id).password_hash, 'unused')

    def test_adopts_existing_account_and_preserves_managed_credentials(self):
        original_id = self.user.id
        original_hash = self.user.password_hash
        accounts = ((self.user.username, secrets.token_urlsafe(20), models.UserRole.admin),)
        ensure_default_users(self.db, accounts)
        self.assertEqual(self.user.id, original_id)
        self.assertEqual(self.user.password_hash, original_hash)
        self.assertEqual(self.user.bootstrap_key, accounts[0][0])
        self.user.username += '-renamed'
        self.user.password_hash = utils.get_password_hash('managed-password')
        self.db.commit()
        ensure_default_users(self.db, accounts)
        self.assertTrue(utils.verify_password('managed-password', self.user.password_hash))
        self.assertEqual(self.db.query(models.User).filter_by(bootstrap_key=accounts[0][0]).count(), 1)
        self.assertIsNone(self.db.query(models.User).filter_by(username=accounts[0][0]).first())

    def test_unconfigured_passwords_do_not_seed_accounts(self):
        before = self.db.query(models.User).count()
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configured_default_users(), ())
            ensure_default_users(self.db)
        self.assertEqual(self.db.query(models.User).count(), before)

    def test_environment_is_read_at_startup_and_empty_passwords_are_skipped(self):
        password = secrets.token_urlsafe(20)
        with patch.dict(os.environ, {'BOOTSTRAP_ADMIN_PASSWORD': password, 'BOOTSTRAP_USER1_PASSWORD': ''}, clear=True):
            self.assertEqual(configured_default_users(), (('admin', password, models.UserRole.admin),))
        with patch.dict(os.environ, {'BOOTSTRAP_USER2_PASSWORD': password}, clear=True):
            self.assertEqual(configured_default_users(), (('user2', password, models.UserRole.user),))

    def test_default_entry_point_uses_environment_password(self):
        username = self.user.username + '-configured'
        password = secrets.token_urlsafe(20)
        with patch('backend.bootstrap_users.DEFAULT_USERS', ((username, 'BOOTSTRAP_ADMIN_PASSWORD', models.UserRole.admin),)):
            with patch.dict(os.environ, {'BOOTSTRAP_ADMIN_PASSWORD': password}, clear=True):
                ensure_default_users(self.db)
                created = self.db.query(models.User).filter_by(username=username).one()
                self.assertEqual(created.role, models.UserRole.admin)
                self.assertTrue(utils.verify_password(password, created.password_hash))
                original_hash = created.password_hash
                os.environ['BOOTSTRAP_ADMIN_PASSWORD'] = secrets.token_urlsafe(20)
                ensure_default_users(self.db)
                self.assertEqual(created.password_hash, original_hash)
