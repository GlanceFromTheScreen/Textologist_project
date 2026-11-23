"""Bidirectional preset rules. Character rules never match without word context."""
from collections import defaultdict


def value(record, field, default=None):
    result = record.get(field, default) if isinstance(record, dict) else getattr(record, field, default)
    return getattr(result, 'value', result)


def operation_key(op_type, old, new):
    """Insert/delete are inverses; changes and replacements are unordered pairs."""
    old, new = old or '', new or ''
    reverse_type = {'insert': 'delete', 'delete': 'insert'}.get(op_type, op_type)
    return min((op_type, old, new), (reverse_type, new, old))


def context_key(old, new):
    return tuple(sorted((old, new)))


def class_rank(class_id, classes):
    return (classes[class_id].display_name, class_id)


def collect_preset_rules(words, classes):
    """Save classified changes only. Deduplicate inverse rules within each context."""
    groups = {}

    def add(kind, op_type, old, new, class_id, base_word=None, other_word=None):
        cls = classes.get(class_id)
        if cls is None or cls.kind != kind:
            return
        op_type, old, new = operation_key(op_type, old, new)
        if kind == 'char':
            if not base_word or not other_word:
                return
            base_word, other_word = context_key(base_word, other_word)
        key = (kind, op_type, old, new, base_word, other_word)
        previous = groups.get(key)
        if previous and class_rank(previous['class_id'], classes) <= class_rank(class_id, classes):
            return
        groups[key] = dict(kind=kind, op_type=op_type, from_str=old, to_str=new,
                           base_word=base_word, other_word=other_word, class_id=class_id)

    def characters(word):
        for char in value(word, 'char_ops', []) or []:
            add('char', value(char, 'op_type'), value(char, 'from_str'), value(char, 'to_str'),
                value(char, 'class_id'), value(word, 'base_token'), value(word, 'other_token'))

    for word in words:
        if value(word, 'op_type') != 'equal':
            add('word', value(word, 'op_type'), value(word, 'base_token'), value(word, 'other_token'), value(word, 'class_id'))
        characters(word)
        # Keep character annotations tucked inside a transposition, too.
        for part in value(word, 'transpose_parts', []) or []:
            characters(part)
    return list(groups.values())


class PresetMatcher:
    def __init__(self, rules, classes):
        self.classes = classes
        self.char_index = defaultdict(list)
        self.word_index = defaultdict(list)
        for rule in rules:
            kind, class_id = value(rule, 'kind', 'char'), value(rule, 'class_id')
            cls = classes.get(class_id)
            if value(rule, 'is_deleted', False) or cls is None or cls.kind != kind:
                continue
            key = operation_key(value(rule, 'op_type'), value(rule, 'from_str'), value(rule, 'to_str'))
            if kind == 'word':
                self.word_index[key].append(rule)
            elif value(rule, 'base_word') and value(rule, 'other_word'):
                for word in {value(rule, 'base_word'), value(rule, 'other_word')}:
                    self.char_index[(key, word)].append(rule)

    def character(self, op_type, old, new, base_word, other_word):
        if not base_word or not other_word:
            return None
        key = operation_key(op_type, old, new)
        candidates = [rule for word in {base_word, other_word} for rule in self.char_index.get((key, word), [])]
        if not candidates:
            return None
        context = context_key(base_word, other_word)
        # An exact pair takes precedence over a single overlapping word. Class-name
        # tie breaking retains the old preset policy and is independent of direction.
        rule = min(candidates, key=lambda r: (
            context_key(value(r, 'base_word'), value(r, 'other_word')) != context,
            class_rank(value(r, 'class_id'), self.classes), value(r, 'id', 0),
        ))
        return value(rule, 'class_id')

    def word(self, op_type, old, new):
        if op_type == 'equal':
            return None
        rules = self.word_index.get(operation_key(op_type, old, new), [])
        if not rules:
            return None
        return value(min(rules, key=lambda r: (class_rank(value(r, 'class_id'), self.classes), value(r, 'id', 0))), 'class_id')
