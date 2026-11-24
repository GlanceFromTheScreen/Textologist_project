from fastapi import HTTPException
from backend import models, schemas, dependencies
from backend.main import app
from backend.routers.comparisons import update_word_op
from backend.routers.stats import get_comparison_stats
from backend.tests.test_comparison_import import ComparisonDatabaseTestCase
from backend.tests import test_user_management as api_tests


def replacement(word, cls=None):
    return dict(op_type='replace', base_token=word, other_token=word.replace('b', 'x'), base_paragraph_index=0,
                char_ops=[dict(op_type='change', from_str='b', to_str='x', class_id=cls)])


def transpose():
    return dict(op_type='transpose', base_token='left right', other_token='right left', base_paragraph_index=0, char_ops=[],
                transpose_parts=[dict(op_type='replace', base_token='left', other_token='right', base_paragraph_index=0, char_ops=[]),
                                 dict(op_type='replace', base_token='right', other_token='left', base_paragraph_index=0, char_ops=[])])


class StatsSignificanceTests(ComparisonDatabaseTestCase):
    def setUp(self):
        super().setUp()
        payload=[replacement('aba',77), replacement('cba'), replacement('dba',77),
                 dict(op_type='equal',base_token='bb',other_token='bb',base_paragraph_index=0,char_ops=[])]
        for kind in ['insert','delete']:
            for _ in range(2):
                payload.append(dict(op_type=kind,base_token='z' if kind=='delete' else None,
                                    other_token='z' if kind=='insert' else None,base_paragraph_index=0,char_ops=[]))
        payload.extend([transpose(),transpose()])
        self.comp=self.upload(payload)
        self.builtin=self.db.query(models.ClassCatalog).filter_by(system_key='insignificant').one()
        for index in [2,5,7,9]:
            update_word_op(self.comp.word_ops[index].id,schemas.WordClassUpdate(class_id=self.builtin.id),self.user,self.db)
        # A personal class with the same name must NOT be treated as the built-in class.
        lookalike=models.ClassCatalog(owner_user_id=self.user.id,kind='word',code='same-name',display_name='Несущественные изменения',color_hex='#abcdef')
        self.db.add(lookalike);self.db.flush()
        update_word_op(self.comp.word_ops[1].id,schemas.WordClassUpdate(class_id=lookalike.id),self.user,self.db)

    def stats(self,mode):
        return get_comparison_stats(self.comp.id,self.user,self.db,significance=mode)

    def test_default_and_totals_include_unclassified_and_use_system_key(self):
        self.assertEqual(get_comparison_stats(self.comp.id,self.user,self.db),self.stats('all'))
        for mode,expected in [('all',(3,2,2,2)),('significant',(2,1,1,1)),('insignificant',(1,1,1,1))]:
            data=self.stats(mode)
            self.assertEqual((data.totals.replace,data.totals.insert,data.totals.delete,data.totals.transpose),expected)
            self.assertEqual(sum(w.count for w in data.top_word_replacements),expected[0])

    def test_char_counts_contexts_frequencies_and_distribution_share_filter(self):
        for mode,count in [('all',3),('significant',2),('insignificant',1)]:
            data=self.stats(mode)
            self.assertEqual(len(data.top_char_ops),1)
            self.assertEqual(data.top_char_ops[0].count,count)
            self.assertEqual(data.top_char_ops[0].unique_contexts,count)
            self.assertAlmostEqual(data.top_char_ops[0].frequency,count/5)
            self.assertEqual(sum(c.count for c in data.class_distribution),count)
        self.assertTrue(any(c.display_name=='Без класса' for c in self.stats('significant').class_distribution))
        self.assertFalse(any(c.class_id is None for c in self.stats('insignificant').class_distribution))

    def test_reclassification_updates_stats_without_modifying_operations(self):
        word=self.comp.word_ops[0]
        update_word_op(word.id,schemas.WordClassUpdate(class_id=self.builtin.id),self.user,self.db)
        self.assertEqual(self.stats('significant').totals.replace,1)
        self.assertEqual(self.stats('insignificant').totals.replace,2)
        update_word_op(word.id,schemas.WordClassUpdate(class_id=None),self.user,self.db)
        self.assertEqual(self.stats('significant').totals.replace,2)
        self.assertEqual(self.db.get(models.ComparisonWordOp,word.id).base_token,'aba')

    def test_empty_category_returns_zero_totals_and_empty_lists(self):
        for word in self.comp.word_ops:
            if word.op_type == 'equal':
                continue
            update_word_op(word.id,schemas.WordClassUpdate(class_id=None),self.user,self.db)
        data=self.stats('insignificant')
        self.assertEqual(sum(data.totals.model_dump().values()),0)
        self.assertEqual(data.top_word_replacements,[])
        self.assertEqual(data.top_char_ops,[])
        self.assertEqual(data.class_distribution,[])

    def test_filter_never_bypasses_comparison_ownership(self):
        for mode in ['all','significant','insignificant']:
            with self.assertRaises(HTTPException) as error:
                get_comparison_stats(self.comp.id,self.other_user,self.db,significance=mode)
            self.assertEqual(error.exception.status_code,404)

    def test_api_validates_query_parameter_and_default(self):
        # Reuse the ASGI harness without requiring an extra HTTP test dependency.
        import asyncio, json
        token=api_tests.UserManagementTests.token(self,self.user)
        async def request(query):
            messages=[]
            scope=dict(type='http',asgi={'version':'3.0'},http_version='1.1',method='GET',scheme='http',
                       path=f'/comparisons/{self.comp.id}/stats',raw_path=f'/comparisons/{self.comp.id}/stats'.encode(),
                       query_string=query.encode(),root_path='',headers=[(b'authorization',('Bearer '+token).encode())],client=('127.0.0.1',1),server=('testserver',80))
            async def receive():return {'type':'http.request','body':b'','more_body':False}
            async def send(message):messages.append(message)
            await app(scope,receive,send)
            return next(m['status'] for m in messages if m['type']=='http.response.start'),json.loads(b''.join(m.get('body',b'') for m in messages if m['type']=='http.response.body'))
        app.dependency_overrides[dependencies.get_db]=lambda:self.db
        try:
            status,data=asyncio.run(request(''));self.assertEqual(status,200);self.assertEqual(data['totals']['replace'],3)
            status,data=asyncio.run(request('significance=all'));self.assertEqual(status,200);self.assertEqual(data['totals']['replace'],3)
            for query in ['significance=invalid', 'page=0', 'page=-1', 'page=text']:
                status,_=asyncio.run(request(query));self.assertEqual(status,422)
        finally:app.dependency_overrides.clear()

    def test_word_statistics_cover_all_change_types_and_classes(self):
        for mode,total in [('all',9),('significant',5),('insignificant',4)]:
            data=self.stats(mode)
            self.assertEqual(sum(item.count for item in data.word_class_distribution),total)
            self.assertEqual(sum(item.count for item in data.top_word_ops),total)
            self.assertEqual({item.op_type.value for item in data.top_word_ops},{'replace','insert','delete','transpose'})
            self.assertTrue(all(item.op_type.value!='equal' for item in data.top_word_ops))
        hidden=self.stats('insignificant')
        self.assertEqual(len(hidden.word_class_distribution),1)
        self.assertEqual(hidden.word_class_distribution[0].class_id,self.builtin.id)
        self.assertEqual(hidden.word_class_distribution[0].count,4)
        ordinary=self.stats('significant')
        self.assertEqual(next(item.count for item in ordinary.word_class_distribution if item.class_id is None),4)
        self.assertFalse(any(item.class_id==self.builtin.id for item in ordinary.top_word_ops))

    def test_repeated_words_group_by_operation_and_class_not_character_count(self):
        # The first two replacements share tokens and class, but have different
        # numbers of character annotations. Word counts must still be two.
        first=self.db.get(models.ComparisonWordOp,self.comp.word_ops[0].id)
        second=self.db.get(models.ComparisonWordOp,self.comp.word_ops[1].id)
        third=self.db.get(models.ComparisonWordOp,self.comp.word_ops[2].id)
        for word in [second,third]:
            word.base_token=first.base_token;word.other_token=first.other_token
        second.class_id=first.class_id
        self.db.add(models.ComparisonCharOp(comparison_id=self.comp.id,word_op_id=first.id,
                                           op_type=models.OpType.delete,from_str='a',to_str='',class_id=None))
        self.db.flush()
        changes=[item for item in self.stats('all').top_word_ops if item.op_type.value=='replace']
        self.assertEqual(sorted(item.count for item in changes),[1,2])
        self.assertEqual(next(item.count for item in changes if item.class_id is None),2)
        self.assertEqual(sum(item.count for item in self.stats('all').word_class_distribution),9)

    def test_empty_word_statistics_respect_selected_filter(self):
        for word in self.comp.word_ops:
            if word.op_type!='equal':
                update_word_op(word.id,schemas.WordClassUpdate(class_id=None),self.user,self.db)
        self.assertEqual(self.stats('insignificant').top_word_ops,[])
        self.assertEqual(self.stats('insignificant').word_class_distribution,[])

    def test_overview_breakdown_does_not_depend_on_filter_or_page(self):
        expected={'all':dict(replace=3,insert=2,delete=2,transpose=2),
                  'significant':dict(replace=2,insert=1,delete=1,transpose=1),
                  'insignificant':dict(replace=1,insert=1,delete=1,transpose=1)}
        for mode in expected:
            data=get_comparison_stats(self.comp.id,self.user,self.db,significance=mode,page=20)
            self.assertEqual(data.totals_by_significance.model_dump(),expected)
            self.assertEqual(data.totals.model_dump(),expected[mode])
            self.assertEqual(data.char_ops_page,1)

    def pagination_comparison(self):
        payload=[]
        for index in range(25):
            char=chr(0x410+index)
            repetitions=12 if index==0 else 3 if index==1 else 2
            for occurrence in range(repetitions):
                context=0 if index==0 else occurrence
                payload.append(dict(op_type='replace',base_token=f'{char}{context}',other_token=f'x{context}',
                                    base_paragraph_index=0,char_ops=[dict(op_type='change',from_str=char,to_str='x')]))
        return self.upload(payload)

    def test_context_ranking_and_all_pages_are_stable_complete_and_disjoint(self):
        comp=self.pagination_comparison()
        pages=[get_comparison_stats(comp.id,self.user,self.db,page=page) for page in [1,2,3]]
        self.assertEqual([len(page.top_char_ops) for page in pages],[10,10,5])
        self.assertEqual([page.char_ops_page for page in pages],[1,2,3])
        self.assertTrue(all(page.char_ops_total==25 and page.char_ops_pages==3 and page.char_ops_page_size==10 for page in pages))
        rows=[row for page in pages for row in page.top_char_ops]
        self.assertEqual(len({(row.op_type,row.from_str,row.to_str) for row in rows}),25)
        self.assertEqual([row.unique_contexts for row in rows],sorted([row.unique_contexts for row in rows],reverse=True))
        self.assertEqual(rows[0].from_str,'Б')
        self.assertEqual(rows[-1].from_str,'А') # 12 occurrences but only one context
        self.assertEqual(rows[-1].count,12)
        again=get_comparison_stats(comp.id,self.user,self.db,page=2)
        self.assertEqual(again.top_char_ops,pages[1].top_char_ops)
        self.assertEqual(pages[0].class_distribution,pages[2].class_distribution)
        self.assertEqual(sum(item.count for item in pages[0].class_distribution),61)
        self.assertEqual(get_comparison_stats(comp.id,self.user,self.db,page=999).char_ops_page,3)

    def test_pagination_counts_follow_significance_and_empty_state(self):
        comp=self.pagination_comparison()
        for word in comp.word_ops[12:15]:
            update_word_op(word.id,schemas.WordClassUpdate(class_id=self.builtin.id),self.user,self.db)
        hidden=get_comparison_stats(comp.id,self.user,self.db,significance='insignificant',page=3)
        self.assertEqual((hidden.char_ops_total,hidden.char_ops_pages,hidden.char_ops_page),(1,1,1))
        self.assertEqual(hidden.top_char_ops[0].from_str,'Б')
        significant=get_comparison_stats(comp.id,self.user,self.db,significance='significant',page=3)
        self.assertEqual((significant.char_ops_total,significant.char_ops_pages,len(significant.top_char_ops)),(24,3,4))
        empty=self.upload([dict(op_type='equal',base_token='same',other_token='same',char_ops=[])])
        data=get_comparison_stats(empty.id,self.user,self.db,page=5)
        self.assertEqual((data.char_ops_total,data.char_ops_page,data.char_ops_pages),(0,1,1))
        self.assertEqual(data.top_char_ops,[])
