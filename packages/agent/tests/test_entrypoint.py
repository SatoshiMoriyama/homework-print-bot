"""Tests for print_generator.entrypoint handle_generate_print."""

import sys
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Mock unavailable third-party modules AND internal modules that depend on them
# BEFORE importing the entrypoint module.
#
# The problem: entrypoint.py does `from .agent import generate_print, regenerate_print`
# which triggers agent.py (imports strands + uses Python 3.10 syntax on Py3.9).
# Also, adaptive_learning/agent.py imports strands.
# Solution: pre-populate sys.modules with mocks for these modules.
# ---------------------------------------------------------------------------

# Third-party modules not available in test env
_mock_strands = MagicMock()
_mock_strands_models = MagicMock()
_mock_strands_models_bedrock = MagicMock()
_mock_playwright = MagicMock()
_mock_playwright_async_api = MagicMock()

sys.modules.setdefault("strands", _mock_strands)
sys.modules.setdefault("strands.models", _mock_strands_models)
sys.modules.setdefault("strands.models.bedrock", _mock_strands_models_bedrock)
sys.modules.setdefault("playwright", _mock_playwright)
sys.modules.setdefault("playwright.async_api", _mock_playwright_async_api)

# Mock the internal agent modules that contain incompatible syntax (Py 3.10+)
# and strands dependencies. We mock them as modules with the needed attributes.
_mock_print_agent_module = MagicMock()
_mock_print_agent_module.generate_print = MagicMock()
_mock_print_agent_module.regenerate_print = MagicMock()
sys.modules.setdefault("src.print_generator.agent", _mock_print_agent_module)

_mock_adaptive_agent_module = MagicMock()
_mock_adaptive_agent_module.determine_next_problem = MagicMock()
sys.modules.setdefault("src.adaptive_learning.agent", _mock_adaptive_agent_module)

# Now it's safe to import the entrypoint module
from src.print_generator.entrypoint import handle_generate_print  # noqa: E402

# Ensure the adaptive_learning package has an 'agent' attribute pointing to
# our mock so that unittest.mock.patch can resolve the dotted path correctly.
import src.adaptive_learning as _adaptive_learning_pkg  # noqa: E402

_adaptive_learning_pkg.agent = _mock_adaptive_agent_module  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_dynamodb():
    """Mock boto3 DynamoDB resource."""
    with patch("src.print_generator.entrypoint.dynamodb") as mock_db:
        yield mock_db


@pytest.fixture
def mock_s3_client():
    """Mock boto3 S3 client."""
    with patch("src.print_generator.entrypoint.s3_client") as mock_s3:
        yield mock_s3


@pytest.fixture
def mock_generate_print():
    """Mock generate_print function."""
    with patch("src.print_generator.entrypoint.generate_print") as mock_gen:
        mock_gen.return_value = {
            "questions": [
                {"number": 1, "text": "1 + 1 =", "correct_formula": "1+1", "correct_answer": "2"},
                {"number": 2, "text": "2 + 3 =", "correct_formula": "2+3", "correct_answer": "5"},
            ]
        }
        yield mock_gen


@pytest.fixture
def mock_render_to_png():
    """Mock render_to_png to return PNG-like bytes."""
    with patch("src.print_generator.entrypoint.render_to_png") as mock_render:
        # Return PNG magic bytes to simulate a PNG image
        mock_render.return_value = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        yield mock_render


@pytest.fixture
def mock_determine_next_problem():
    """Mock determine_next_problem from adaptive_learning."""
    with patch("src.adaptive_learning.agent.determine_next_problem") as mock_dnp:
        mock_dnp.return_value = {
            "category": "number_calculation",
            "subcategory": "addition_with_carry",
            "difficulty": 2,
            "question_count": 8,
            "weak_areas": ["addition_no_carry"],
            "should_advance": False,
        }
        yield mock_dnp


class TestHandleGeneratePrintAutoSelect:
    """Tests for handle_generate_print when no subcategory is provided (auto-selection)."""

    @pytest.mark.asyncio
    async def test_no_subcategory_fetches_child_and_calls_determine_next_problem(
        self,
        mock_dynamodb,
        mock_s3_client,
        mock_generate_print,
        mock_render_to_png,
        mock_determine_next_problem,
    ):
        """When params has no subcategory, should look up child's current_unit_order
        from CHILDREN_TABLE and call determine_next_problem."""
        # Setup mock tables
        children_table = MagicMock()
        children_table.get_item.return_value = {
            "Item": {"child_id": "child-1", "current_unit_order": 3}
        }
        prints_table = MagicMock()

        def table_side_effect(name):
            if name == "homework-bot-children":
                return children_table
            return prints_table

        mock_dynamodb.Table.side_effect = table_side_effect

        payload = {
            "action": "generate_print",
            "child_id": "child-1",
        }

        result = await handle_generate_print(payload)

        # Verify children table was queried
        children_table.get_item.assert_called_once_with(Key={"child_id": "child-1"})

        # Verify determine_next_problem was called with correct args
        mock_determine_next_problem.assert_called_once_with("child-1", 3)

        # Verify generate_print was called with recommendation values
        mock_generate_print.assert_called_once_with(
            child_id="child-1",
            subcategory="addition_with_carry",
            difficulty=2,
            question_count=8,
            weak_areas=["addition_no_carry"],
        )

        # Verify result has expected fields
        assert "print_id" in result
        assert "s3_key" in result
        assert "questions" in result

    @pytest.mark.asyncio
    async def test_no_subcategory_default_unit_order_when_child_missing(
        self,
        mock_dynamodb,
        mock_s3_client,
        mock_generate_print,
        mock_render_to_png,
        mock_determine_next_problem,
    ):
        """When child record has no current_unit_order, defaults to 1."""
        children_table = MagicMock()
        children_table.get_item.return_value = {
            "Item": {"child_id": "child-1"}
        }
        prints_table = MagicMock()

        def table_side_effect(name):
            if name == "homework-bot-children":
                return children_table
            return prints_table

        mock_dynamodb.Table.side_effect = table_side_effect

        payload = {
            "action": "generate_print",
            "child_id": "child-1",
        }

        await handle_generate_print(payload)

        # Should default to unit_order 1
        mock_determine_next_problem.assert_called_once_with("child-1", 1)

    @pytest.mark.asyncio
    async def test_no_subcategory_child_not_found_defaults_to_unit_order_1(
        self,
        mock_dynamodb,
        mock_s3_client,
        mock_generate_print,
        mock_render_to_png,
        mock_determine_next_problem,
    ):
        """When child record is not found in DB, defaults to current_unit_order=1."""
        children_table = MagicMock()
        children_table.get_item.return_value = {}  # No Item
        prints_table = MagicMock()

        def table_side_effect(name):
            if name == "homework-bot-children":
                return children_table
            return prints_table

        mock_dynamodb.Table.side_effect = table_side_effect

        payload = {
            "action": "generate_print",
            "child_id": "child-1",
            "params": {},
        }

        await handle_generate_print(payload)

        # Should default to unit_order 1
        mock_determine_next_problem.assert_called_once_with("child-1", 1)

    @pytest.mark.asyncio
    async def test_category_saved_to_prints_table(
        self,
        mock_dynamodb,
        mock_s3_client,
        mock_generate_print,
        mock_render_to_png,
        mock_determine_next_problem,
    ):
        """Category from determine_next_problem should be saved to prints table."""
        children_table = MagicMock()
        children_table.get_item.return_value = {
            "Item": {"child_id": "child-1", "current_unit_order": 6}
        }
        prints_table = MagicMock()

        def table_side_effect(name):
            if name == "homework-bot-children":
                return children_table
            return prints_table

        mock_dynamodb.Table.side_effect = table_side_effect

        payload = {
            "action": "generate_print",
            "child_id": "child-1",
        }

        await handle_generate_print(payload)

        # Verify prints table put_item was called with category from recommendation
        put_item_call = prints_table.put_item.call_args
        item = put_item_call[1]["Item"] if "Item" in (put_item_call[1] or {}) else put_item_call[0][0] if put_item_call[0] else put_item_call[1]["Item"]
        assert item["category"] == "number_calculation"
        assert item["subcategory"] == "addition_with_carry"


class TestHandleGeneratePrintExplicitSubcategory:
    """Tests for handle_generate_print when subcategory is explicitly provided (backward compat)."""

    @pytest.mark.asyncio
    async def test_explicit_subcategory_does_not_call_determine_next_problem(
        self,
        mock_dynamodb,
        mock_s3_client,
        mock_generate_print,
        mock_render_to_png,
        mock_determine_next_problem,
    ):
        """When params contains subcategory, should use it directly without calling
        determine_next_problem or CHILDREN_TABLE."""
        prints_table = MagicMock()
        mock_dynamodb.Table.return_value = prints_table

        payload = {
            "action": "generate_print",
            "child_id": "child-1",
            "params": {
                "subcategory": "subtraction_no_borrow",
                "difficulty": 3,
                "question_count": 10,
                "category": "number_calculation",
            },
        }

        result = await handle_generate_print(payload)

        # determine_next_problem should NOT be called
        mock_determine_next_problem.assert_not_called()

        # generate_print should use the explicit params
        mock_generate_print.assert_called_once_with(
            child_id="child-1",
            subcategory="subtraction_no_borrow",
            difficulty=3,
            question_count=10,
            weak_areas=[],
        )

        assert "print_id" in result
        assert "questions" in result

    @pytest.mark.asyncio
    async def test_explicit_subcategory_with_defaults(
        self,
        mock_dynamodb,
        mock_s3_client,
        mock_generate_print,
        mock_render_to_png,
        mock_determine_next_problem,
    ):
        """When params contains only subcategory, other fields use defaults."""
        prints_table = MagicMock()
        mock_dynamodb.Table.return_value = prints_table

        payload = {
            "action": "generate_print",
            "child_id": "child-1",
            "params": {
                "subcategory": "addition_no_carry",
            },
        }

        await handle_generate_print(payload)

        mock_determine_next_problem.assert_not_called()

        mock_generate_print.assert_called_once_with(
            child_id="child-1",
            subcategory="addition_no_carry",
            difficulty=1,
            question_count=8,
            weak_areas=[],
        )
