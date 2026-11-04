from email.utils import parseaddr

from django.core.exceptions import ValidationError
from django.core.validators import validate_email


def normalize_domain(value):
    try:
        return value.strip().rstrip(".").encode("idna").decode("ascii").lower()
    except (AttributeError, UnicodeError):
        return ""


def sender_matches_domain(sender, verified_domain):
    domain = normalize_domain(verified_domain)
    address = parseaddr(sender)[1]
    if not domain or not address or address.count("@") != 1:
        return False
    try:
        validate_email(address)
    except ValidationError:
        return False
    return normalize_domain(address.rsplit("@", 1)[1]) == domain
