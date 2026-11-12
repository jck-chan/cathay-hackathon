import pytest
from relay.synthetic import generate
from relay.store import Store

@pytest.fixture(scope='session')
def dataset(tmp_path_factory):
    path=tmp_path_factory.mktemp('history');generate(path,seed=20261109);return path

@pytest.fixture
def repo(dataset,tmp_path):
    st=Store(str(tmp_path/'case.sqlite'));assert st.load_demo(dataset)
    return st
