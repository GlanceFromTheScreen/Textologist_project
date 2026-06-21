"""Create a user directly in the database. Usage:
    python backend/create_user.py <username> <password> [role]

Example:
    python backend/create_user.py admin admin admin
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import models, utils
from backend.database import SessionLocal


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python backend/create_user.py <username> <password> [admin|textologist]")
        sys.exit(1)

    username = sys.argv[1]
    password = sys.argv[2]
    role_name = sys.argv[3] if len(sys.argv) > 3 else "textologist"

    try:
        role = models.UserRole(role_name)
    except ValueError:
        print(f"Invalid role: {role_name}. Use 'admin' or 'textologist'.")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.username == username).first()
        if existing:
            existing.password_hash = utils.get_password_hash(password)
            existing.role = role
            db.commit()
            print(f"Updated user '{username}' (role={role.value})")
        else:
            user = models.User(
                username=username,
                password_hash=utils.get_password_hash(password),
                role=role,
            )
            db.add(user)
            db.commit()
            print(f"Created user '{username}' (role={role.value})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
