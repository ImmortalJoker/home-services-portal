"""Minimal in-memory stand-in for the Authentik ORM surface used by the
optional-provider runtime verifier. Reads {"code", "world", "base"} as JSON on
stdin, executes the generated verifier with separate globals/locals (the
strictest way a shell could run it), and prints OK or FAIL: <message>."""
import enum
import json
import sys
import types


class DoesNotExist(Exception):
    pass


class QuerySet:
    def __init__(self, items):
        self._items = list(items)

    def _matches(self, item, lookups):
        for lookup, expected in lookups.items():
            if lookup.endswith('__in'):
                if getattr(item, lookup[:-4]) not in list(expected):
                    return False
            elif getattr(item, lookup) != expected:
                return False
        return True

    def filter(self, **lookups):
        return QuerySet(item for item in self._items if self._matches(item, lookups))

    def get(self, **lookups):
        found = self.filter(**lookups)._items
        if len(found) != 1:
            raise DoesNotExist(repr(lookups))
        return found[0]

    def first(self):
        return self._items[0] if self._items else None

    def count(self):
        return len(self._items)

    def exists(self):
        return bool(self._items)

    def order_by(self, field):
        return QuerySet(sorted(self._items, key=lambda item: getattr(item, field)))

    def values_list(self, *fields, flat=False):
        if flat:
            return [getattr(item, fields[0]) for item in self._items]
        return [tuple(getattr(item, field) for field in fields) for item in self._items]

    def __iter__(self):
        return iter(self._items)


class Manager:
    def __init__(self):
        self.items = []

    def __getattr__(self, name):
        return getattr(QuerySet(self.items), name)


class Record:
    def __init__(self, **fields):
        self.__dict__.update(fields)

    def __eq__(self, other):
        return type(self) is type(other) and self.pk == other.pk

    def __hash__(self):
        return hash((type(self).__name__, self.pk))


def model(name):
    return type(name, (Record,), {'objects': Manager()})


class MatchingMode(enum.Enum):
    STRICT = 'strict'
    REGEX = 'regex'


class RedirectType(enum.Enum):
    AUTHORIZATION = 'authorization'
    LOGOUT = 'logout'


Application = model('Application')
Group = model('Group')
PolicyBinding = model('PolicyBinding')
ProxyProvider = model('ProxyProvider')
OAuth2Provider = model('OAuth2Provider')
ScopeMapping = model('ScopeMapping')
PropertyMapping = model('PropertyMapping')
Outpost = model('Outpost')


def install_modules():
    layout = {
        'authentik.core.models': {'Application': Application, 'Group': Group},
        'authentik.policies.models': {'PolicyBinding': PolicyBinding},
        'authentik.providers.proxy.models': {'ProxyProvider': ProxyProvider},
        'authentik.providers.oauth2.models': {'OAuth2Provider': OAuth2Provider, 'ScopeMapping': ScopeMapping},
    }
    for dotted, members in layout.items():
        parts = dotted.split('.')
        for index in range(1, len(parts) + 1):
            name = '.'.join(parts[:index])
            sys.modules.setdefault(name, types.ModuleType(name))
        sys.modules[dotted].__dict__.update(members)


def build_world(world):
    mappings = {}
    for entry in world['scopeMappings']:
        mappings[entry['pk']] = ScopeMapping(**entry)
        ScopeMapping.objects.items.append(mappings[entry['pk']])
    # Non-scope property mappings (e.g. proxy host-header mappings) are not
    # visible through ScopeMapping.objects.
    for entry in world.get('propertyMappings', []):
        mappings[entry['pk']] = PropertyMapping(**entry)
    groups = {}
    for entry in world['groups']:
        groups[entry['name']] = Group(pk=entry['name'], name=entry['name'], attributes=entry['attributes'])
        Group.objects.items.append(groups[entry['name']])
    providers = {}
    for entry in world['proxyProviders']:
        fields = dict(entry, property_mappings=QuerySet(mappings[pk] for pk in entry['property_mappings']))
        providers[entry['pk']] = ProxyProvider(**fields)
        ProxyProvider.objects.items.append(providers[entry['pk']])
    for entry in world['oauth2Providers']:
        uris = [
            types.SimpleNamespace(
                matching_mode=MatchingMode(uri['matching_mode']),
                url=uri['url'],
                redirect_uri_type=RedirectType(uri['redirect_uri_type']),
            )
            for uri in entry['redirect_uris']
        ]
        fields = dict(entry, redirect_uris=uris, property_mappings=QuerySet(mappings[pk] for pk in entry['property_mappings']))
        providers[entry['pk']] = OAuth2Provider(**fields)
        OAuth2Provider.objects.items.append(providers[entry['pk']])
    applications = {}
    for entry in world['applications']:
        fields = dict(entry, provider=providers.get(entry['provider']))
        applications[entry['pk']] = Application(**fields)
        Application.objects.items.append(applications[entry['pk']])
    for index, entry in enumerate(world['bindings']):
        PolicyBinding.objects.items.append(PolicyBinding(
            pk=index,
            target=applications[entry['target']],
            order=entry['order'],
            group=groups.get(entry['group']) if entry['group'] else None,
            user=entry.get('user'),
            policy=entry.get('policy'),
            enabled=entry['enabled'],
            negate=entry['negate'],
        ))
    return Outpost(pk='outpost', name='authentik Embedded Outpost', providers=QuerySet(providers[pk] for pk in world['outpostProviders']))


def main():
    payload = json.load(sys.stdin)
    install_modules()
    outpost = build_world(payload['world'])
    namespace_globals, namespace_locals = {'__builtins__': __builtins__}, {}
    try:
        exec(compile(payload['code'], '<optional-provider-verifier>', 'exec'), namespace_globals, namespace_locals)
        enabled = namespace_globals['portal_verify_optional_providers'](outpost, set(payload['base']))
    except AssertionError as error:
        print('FAIL: ' + str(error))
        return 1
    print('OK ' + json.dumps(enabled))
    return 0


if __name__ == '__main__':
    sys.exit(main())
