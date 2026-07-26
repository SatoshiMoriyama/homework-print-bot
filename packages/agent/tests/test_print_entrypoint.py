"""Tests for print_generator.entrypoint auto-selection logic in handle_generate_print."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_s3_client():
    """Mock s3_client.put_object to avoid real S3 calls."""
    with patch("src.print_generator.entrypoint.s3_client") as mock_s3:
        mock_s3.put_object = MagicMock()
        yield mock_s3


@pytest.fixture
def mock_dynamodb():
    """Mock dynamodb resource and table for PRINTS_TABLE writes."""
    with patch("src.print_generator.entrypoint.dynamodb") as mock_ddb:
        mock_table = MagicMock()
        mock_ddb.Table.return_value = mock_table
        mock_table.put_item = MagicMock()
        yield mock_ddb


@pytest.fixture
def mock_generate_print():
    """Mock generate_print to avoid LLM calls."""
    with patch("src.print_generator.entrypoint.generate_print") as mock_gen:
        mock_gen.return_value = {
            "questions": [
                {"number": 1, "text": "2 + 3 =", "correct_formula": "2+3", "correct_answer": "5"},
                {"number": 2, "text": "4 + 1 =", "correct_formula": "4+1", "correct_answer": "5"},
            ]
        }
        yield mock_gen


@pytest.fixture
def mock_render_html():
    """Mock render_html to avoid actual rendering."""
    with patch("src.print_generator.entrypoint.render_html") as mock_rh:
        mock_rh.return_value = "<html><body>mock</body></html>"
        yield mock_rh


@pytest.fixture
def mock_render_to_png():
    """Mock render_to_png to avoid browser/playwright dependency."""
    with patch("src.print_generator.entrypoint.render_to_png") as mock_rp:
        mock_rp.return_value = b"\x89PNG\r\n\x1a\nfakepngdata"
        yield mock_rp


@pytest.fixture
def mock_determine_next_problem():
    """Mock determine_next_problem from adaptive_learning."""
    with patch("src.adaptive_learning.agent.determine_next_problem") as mock_dnp:
        mock_dnp.return_value = {
            "category": "arithmetic",
            "subcategory": "addition_no_carry",
            "difficulty": 2,
            "question_count": 10,
            "weak_areas": ["carrying"],
            "should_advance": False,
        }
        yield mock_dnp


@pytest.fixture
def common_mocks(mock_s3_client, mock_dynamodb, mock_generate_print, mock_render_html, mock_render_to_png):
    """Bundle common mocks that all test cases need."""
    return {
        "s3_client": mock_s3_client,
        "dynamodb": mock_dynamodb,
        "generate_print": mock_generate_print,
        "render_html": mock_render_html,
        "render_to_png": mock_render_to_png,
    }


async def test_auto_select_when_no_subcategory(common_mocks, mock_determine_next_problem):
    """When params has no subcategory, should fetch current_unit_order and call determine_next_problem."""
    from src.print_generator.entrypoint import handle_generate_print

    child_id = "child-123"
    payload = {
        "action": "generate_print",
        "child_id": child_id,
        "params": {},
    }

    # Mock _get_child_current_unit_order to return a specific value
    with patch("src.print_generator.entrypoint._get_child_current_unit_order", return_value=3) as mock_get_order:
        result = await handle_generate_print(payload)

    # Verify _get_child_current_unit_order was called with the child_id
    mock_get_order.assert_called_once_with(child_id)

    # Verify determine_next_problem was called with child_id and the fetched current_unit_order
    mock_determine_next_problem.assert_called_once_with(child_id, 3)

    # Verify the values from determine_next_problem were used for generate_print
    common_mocks["generate_print"].assert_called_once_with(
        child_id=child_id,
        subcategory="addition_no_carry",
        difficulty=2,
        question_count=10,
        weak_areas=["carrying"],
    )

    # Verify the result contains expected keys
    assert "print_id" in result
    assert "s3_key" in result
    assert "questions" in result


async def test_auto_select_when_params_missing(common_mocks, mock_determine_next_problem):
    """When params is entirely missing from payload, should auto-select via determine_next_problem."""
    from src.print_generator.entrypoint import handle_generate_print

    child_id = "child-456"
    payload = {
        "action": "generate_print",
        "child_id": child_id,
        # no "params" key at all
    }

    with patch("src.print_generator.entrypoint._get_child_current_unit_order", return_value=5) as mock_get_order:
        result = await handle_generate_print(payload)

    # Verify auto-selection path was taken
    mock_get_order.assert_called_once_with(child_id)
    mock_determine_next_problem.assert_called_once_with(child_id, 5)

    assert "print_id" in result
    assert "questions" in result


async def test_explicit_subcategory_skips_auto_select(common_mocks):
    """When params has an explicit subcategory, determine_next_problem should NOT be called."""
    from src.print_generator.entrypoint import handle_generate_print

    child_id = "child-789"
    payload = {
        "action": "generate_print",
        "child_id": child_id,
        "params": {
            "category": "arithmetic",
            "subcategory": "subtraction_no_borrow",
            "difficulty": 3,
            "question_count": 5,
            "weak_areas": ["borrowing"],
        },
    }

    with patch("src.print_generator.entrypoint._get_child_current_unit_order") as mock_get_order:
        with patch("src.adaptive_learning.agent.determine_next_problem") as mock_dnp:
            result = await handle_generate_print(payload)

    # Verify that auto-selection was NOT triggered
    mock_get_order.assert_not_called()
    mock_dnp.assert_not_called()

    # Verify generate_print was called with the explicit params
    common_mocks["generate_print"].assert_called_once_with(
        child_id=child_id,
        subcategory="subtraction_no_borrow",
        difficulty=3,
        question_count=5,
        weak_areas=["borrowing"],
    )

    assert "print_id" in result
    assert "questions" in result


async def test_child_not_found_falls_back_to_unit_order_1(common_mocks, mock_determine_next_problem):
    """When the child record is not found in CHILDREN_TABLE, current_unit_order defaults to 1."""
    from src.print_generator.entrypoint import handle_generate_print

    child_id = "child-unknown"
    payload = {
        "action": "generate_print",
        "child_id": child_id,
        "params": {},
    }

    # Mock the DynamoDB Table for CHILDREN_TABLE to return no item
    mock_children_table = MagicMock()
    mock_children_table.get_item.return_value = {"ResponseMetadata": {}}  # No 'Item' key

    # We need to mock _get_child_current_unit_order's internal DynamoDB call
    # The cleanest way: directly test _get_child_current_unit_order returns 1,
    # then verify determine_next_problem is called with 1
    with patch("src.print_generator.entrypoint._get_child_current_unit_order", return_value=1) as mock_get_order:
        result = await handle_generate_print(payload)

    mock_get_order.assert_called_once_with(child_id)
    mock_determine_next_problem.assert_called_once_with(child_id, 1)

    assert "print_id" in result
    assert "questions" in result


async def test_get_child_current_unit_order_child_not_found():
    """_get_child_current_unit_order returns 1 when child is not in table."""
    from src.print_generator.entrypoint import _get_child_current_unit_order

    mock_table = MagicMock()
    mock_table.get_item.return_value = {"ResponseMetadata": {}}  # No 'Item'

    with patch("src.print_generator.entrypoint.dynamodb") as mock_ddb:
        mock_ddb.Table.return_value = mock_table
        result = _get_child_current_unit_order("nonexistent-child")

    assert result == 1


async def test_get_child_current_unit_order_child_found():
    """_get_child_current_unit_order returns the child's current_unit_order from DynamoDB."""
    from src.print_generator.entrypoint import _get_child_current_unit_order

    mock_table = MagicMock()
    mock_table.get_item.return_value = {
        "Item": {"child_id": "child-123", "current_unit_order": 7}
    }

    with patch("src.print_generator.entrypoint.dynamodb") as mock_ddb:
        mock_ddb.Table.return_value = mock_table
        result = _get_child_current_unit_order("child-123")

    assert result == 7


async def test_get_child_current_unit_order_exception_fallback():
    """_get_child_current_unit_order returns 1 on DynamoDB exception and logs a warning."""
    from src.print_generator.entrypoint import _get_child_current_unit_order

    mock_table = MagicMock()
    mock_table.get_item.side_effect = Exception("DynamoDB error")

    with patch("src.print_generator.entrypoint.dynamodb") as mock_ddb:
        mock_ddb.Table.return_value = mock_table
        with patch("src.print_generator.entrypoint.logger") as mock_logger:
            result = _get_child_current_unit_order("child-error")

    assert result == 1
    mock_logger.warning.assert_called_once()


async def test_get_child_current_unit_order_logs_warning_on_client_error():
    """_get_child_current_unit_order logs a warning on ClientError and returns 1."""
    from botocore.exceptions import ClientError
    from src.print_generator.entrypoint import _get_child_current_unit_order

    mock_table = MagicMock()
    mock_table.get_item.side_effect = ClientError(
        {"Error": {"Code": "ProvisionedThroughputExceededException", "Message": "Throttled"}},
        "GetItem",
    )

    with patch("src.print_generator.entrypoint.dynamodb") as mock_ddb:
        mock_ddb.Table.return_value = mock_table
        with patch("src.print_generator.entrypoint.logger") as mock_logger:
            result = _get_child_current_unit_order("child-throttled")

    assert result == 1
    mock_logger.warning.assert_called_once()


async def test_determine_next_problem_failure_falls_back_to_defaults(common_mocks):
    """When determine_next_problem raises an exception, fall back to default values."""
    from src.print_generator.entrypoint import handle_generate_print

    child_id = "child-error"
    payload = {
        "action": "generate_print",
        "child_id": child_id,
        "params": {},
    }

    with patch("src.print_generator.entrypoint._get_child_current_unit_order", return_value=3):
        with patch(
            "src.adaptive_learning.agent.determine_next_problem",
            side_effect=RuntimeError("LLM service unavailable"),
        ):
            result = await handle_generate_print(payload)

    # Verify fallback defaults were used for generate_print
    common_mocks["generate_print"].assert_called_once_with(
        child_id=child_id,
        subcategory="addition_no_carry",
        difficulty=1,
        question_count=8,
        weak_areas=[],
    )

    # Verify the result is still successful (print was generated)
    assert "print_id" in result
    assert "s3_key" in result
    assert "questions" in result
