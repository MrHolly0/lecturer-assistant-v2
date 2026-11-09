#!/usr/bin/env python3
"""Offline capacity arithmetic. Never starts services or declares benchmark success."""
import argparse
import json
import math
from pathlib import Path


def positive(value, name, integer=False, allow_zero=False):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if value < 0 or (not allow_zero and value == 0):
        raise ValueError(f"{name} is out of range")
    if integer and type(value) is not int:
        raise ValueError(f"{name} must be an integer")
    return value


def packing_bins(room_rates, capacity):
    """Best-fit decreasing; a possible packing, not an optimality certificate."""
    used = []
    for rate in sorted(room_rates, reverse=True):
        if rate > capacity + 1e-9:
            return None
        candidates = [i for i, load in enumerate(used) if load + rate <= capacity + 1e-9]
        if candidates:
            target = max(candidates, key=lambda i: used[i])
            used[target] += rate
        else:
            used.append(rate)
    return used


def estimate(model):
    integer_fields = [
        'students', 'lessons', 'video_viewers', 'gateway_replicas',
        'gateway_connection_acceptance_target', 'public_event_bytes', 'latest_state_queue_bytes',
        'private_item_bytes', 'connection_metadata_bytes',
        'postgres_max_connections', 'postgres_reserved_connections'
    ]
    for key in integer_fields:
        positive(model[key], key, integer=True)
    positive(model['private_queue_items'], 'private_queue_items', integer=True, allow_zero=True)
    positive(model.get('transport_buffer_bytes', 0), 'transport_buffer_bytes', integer=True, allow_zero=True)
    for key in ['teacher_connections_per_lesson', 'projector_connections_per_lesson', 'failed_nodes']:
        positive(model[key], key, integer=True, allow_zero=True)
    for key in [
        'network_overhead_factor', 'publisher_layer_factor', 'media_node_nic_gbps', 'usable_nic_fraction',
        'public_events_per_second', 'auth_lease_seconds', 'media_auth_lease_seconds', 'join_window_seconds',
        'reconnect_window_seconds', 'vote_window_seconds', 'signal_window_seconds',
        'receipt_interval_seconds', 'question_peak_rps', 'teacher_commands_per_second_per_lesson'
    ]:
        positive(model[key], key)
    positive(model['turn_fraction'], 'turn_fraction', allow_zero=True)
    refresh = model.get('auth_refresh_seconds', model['auth_lease_seconds'])
    media_refresh = model.get('media_auth_refresh_seconds', model['media_auth_lease_seconds'])
    positive(refresh, 'auth_refresh_seconds')
    positive(media_refresh, 'media_auth_refresh_seconds')
    if refresh > model['auth_lease_seconds'] or media_refresh > model['media_auth_lease_seconds']:
        raise ValueError('Permission refresh must not exceed its lease')
    if model['usable_nic_fraction'] > 1 or model['turn_fraction'] > 1:
        raise ValueError('Fractions must not exceed one')
    if model['network_overhead_factor'] < 1:
        raise ValueError('Network overhead cannot reduce payload traffic')
    if model['publisher_layer_factor'] < 1:
        raise ValueError('Publisher layers cannot reduce the selected video profile')
    if model['video_viewers'] > model['students']:
        raise ValueError('Video viewers cannot exceed students in this model')
    surviving = model['gateway_replicas'] - model['failed_nodes']
    if surviving <= 0:
        raise ValueError('No surviving gateway replicas')
    rooms = []
    for item in model['room_distribution']:
        positive(item['rooms'], 'rooms', integer=True)
        positive(item['viewers'], 'viewers', integer=True)
        rooms.extend([item['viewers']] * item['rooms'])
    if len(rooms) != model['lessons'] or sum(rooms) != model['video_viewers']:
        raise ValueError('Room distribution must match lessons and video_viewers')
    if not model['video_profiles_mbps']:
        raise ValueError('At least one video profile is required')

    overhead = model['network_overhead_factor']
    node_gbps = model['media_node_nic_gbps'] * model['usable_nic_fraction']
    media = []
    for bitrate in model['video_profiles_mbps']:
        positive(bitrate, 'video bitrate')
        payload = model['video_viewers'] * bitrate / 1000
        wire = payload * overhead
        room_rates = [viewers * bitrate * overhead / 1000 for viewers in rooms]
        packing = packing_bins(room_rates, node_gbps)
        media.append({
            'viewer_mbps': bitrate,
            'sfu_payload_egress_gbps': payload,
            'sfu_budgeted_egress_gbps': wire,
            'publisher_budgeted_ingress_gbps': model['lessons'] * bitrate * overhead * model['publisher_layer_factor'] / 1000,
            'largest_room_budgeted_egress_gbps': max(room_rates),
            'room_fits_network_budget': packing is not None,
            'aggregate_network_lower_bound_nodes': math.ceil(wire / node_gbps) + model['failed_nodes'],
            'example_packing_nodes_with_idle_spares': None if packing is None else len(packing) + model['failed_nodes'],
            'turn_budgeted_egress_gbps': wire * model['turn_fraction'],
            'turn_ingress_plus_egress_gbps': wire * model['turn_fraction'] * 2,
            'viewer_payload_tb_per_hour': payload * 1e9 * 3600 / 8 / 1e12
        })
    connections = model['students'] + model['lessons'] * (
        model['teacher_connections_per_lesson'] + model['projector_connections_per_lesson'])
    per_gateway = math.ceil(connections / surviving)
    per_client_queue = model['latest_state_queue_bytes'] + (
        model['private_queue_items'] * model['private_item_bytes']) + model['connection_metadata_bytes']
    per_client_queue += model.get('transport_buffer_bytes', 0)
    media_subjects = model['video_viewers'] + model['lessons'] * (1 + model['projector_connections_per_lesson'])
    rates = {
        'votes': model['students'] / model['vote_window_seconds'],
        'signals': model['students'] / model['signal_window_seconds'],
        'receipts': model['students'] / model['receipt_interval_seconds'],
        'questions': model['question_peak_rps'],
        'joins': model['students'] / model['join_window_seconds'],
        'teacher_commands': model['lessons'] * model['teacher_commands_per_second_per_lesson']
    }
    pools = 0
    names = set()
    for pool in model['pools']:
        if pool['service'] in names:
            raise ValueError('Duplicate pool service')
        names.add(pool['service'])
        positive(pool['max_replicas'], 'pool replicas', integer=True)
        positive(pool['connections_each'], 'pool connections', integer=True)
        pools += pool['max_replicas'] * pool['connections_each']
    db_total = pools + model['postgres_reserved_connections']
    return {
        'status': 'planning_only_not_a_benchmark',
        'production_capacity_proven': False,
        'target': {'students': model['students'], 'lessons': model['lessons'], 'video_viewers': model['video_viewers']},
        'media': media,
        'usable_media_node_egress_gbps': node_gbps,
        'gateway': {
            'total_connections': connections,
            'surviving_replicas': surviving,
            'connections_each_after_failure': per_gateway,
            'acceptance_target_each': model['gateway_connection_acceptance_target'],
            'connection_budget_fits': per_gateway <= model['gateway_connection_acceptance_target'],
            'pending_queue_only_mib_each_after_failure': per_client_queue * per_gateway / 1024 ** 2,
            'public_fanout_budget_mbps': connections * model['public_events_per_second'] * model['public_event_bytes'] * 8 * overhead / 1e6,
            'full_reconnects_per_second': connections / model['reconnect_window_seconds'],
            'reconnect_window_seconds': model['reconnect_window_seconds'],
            'auth_lease_seconds': model['auth_lease_seconds'],
            'auth_refresh_seconds': refresh,
            'auth_subject_checks_per_second': connections / refresh
        },
        'media_auth_subject_checks_per_second': media_subjects / media_refresh,
        'total_auth_subject_checks_per_second': connections / refresh + media_subjects / media_refresh,
        'write_operations_rps': rates,
        'combined_peak_operation_rps': sum(rates.values()),
        'database': {'max_connections': model['postgres_max_connections'], 'all_max_replica_pools': pools,
                     'reserved': model['postgres_reserved_connections'], 'total_with_reserve': db_total,
                     'budget_fits': db_total <= model['postgres_max_connections']},
        'unverified': [
            'CPU, packets per second, TLS/native memory and disk/WAL throughput',
            'Actual SFU room placement, failure recovery and TURN capacity',
            'LiveKit/Redis/DB/broker configuration on the selected independent hosts',
            'Network reachability and video quality in real MAX/iOS clients',
            '10k mixed end-to-end load, soak and fault injection'
        ]
    }


def markdown(report):
    g, d = report['gateway'], report['database']
    lines = [
        '# Расчёт требований, не бенчмарк', '',
        'Сгенерировано `e2e/planning/capacity.py` из `capacity-model.json`.', '',
        '**Ёмкость production не подтверждена. Числа ниже являются оценками.**', '',
        '| Видео на зрителя | Payload SFU | Бюджет SFU с запасом | Сетевой минимум узлов N+1 | Пример packing с резервом |',
        '|---|---:|---:|---:|---:|'
    ]
    for m in report['media']:
        packed = m['example_packing_nodes_with_idle_spares']
        lines.append(f"| {m['viewer_mbps']:g} Мбит/с | {m['sfu_payload_egress_gbps']:g} Гбит/с | {m['sfu_budgeted_egress_gbps']:g} Гбит/с | {m['aggregate_network_lower_bound_nodes']} | {packed if packed is not None else 'комната не помещается'} |")
    lines += ['', 'Минимум рассчитан только по NIC. Пример packing предполагает заранее',
              'свободный резервный узел и не моделирует реальный scheduler LiveKit, CPU,',
              'pps или время reconnect. Это не спецификация закупки и не доказательство HA.', '',
              f"- Полезный бюджет исходящего NIC одного media-узла: {report['usable_media_node_egress_gbps']:g} Гбит/с.",
              f"- Подключения с преподавателями и проекторами: {g['total_connections']}; после одного отказа: {g['connections_each_after_failure']} на gateway.",
              f"- Цель отдельного теста одной gateway-реплики: {g['acceptance_target_each']} соединений.",
              f"- Только pending queues одной gateway-реплики после отказа: {g['pending_queue_only_mib_each_after_failure']:.1f} МиБ, без TLS/heap/native/TCP.",
              f"- Верхний сценарий общего fanout: {g['public_fanout_budget_mbps']:.1f} Мбит/с.",
              f"- Полное восстановление за {g['reconnect_window_seconds']:g} секунд: {g['full_reconnects_per_second']:.1f} подключений/с.",
              f"- Проверки субъектов gateway: lease {g['auth_lease_seconds']:g} секунд, refresh {g['auth_refresh_seconds']:g} секунд: {g['auth_subject_checks_per_second']:.0f}/с, нужны batch-запросы.",
              f"- Вместе с проверками media agent: {report['total_auth_subject_checks_per_second']:.0f} subject checks/с.",
              f"- Сумма заданных пиков бизнес-операций: {report['combined_peak_operation_rps']:.1f}/с; это не количество SQL-записей.",
              f"- DB pools на максимуме реплик: {d['all_max_replica_pools']}; вместе с резервом {d['total_with_reserve']} из {d['max_connections']}.", '',
              '## Отдельные пики', '', '| Операция | Операций/с |', '|---|---:|']
    lines += [f'| {name} | {rate:.1f} |' for name, rate in report['write_operations_rps'].items()]
    lines += ['', '## Что ещё надо измерить', ''] + ['- ' + value for value in report['unverified']]
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=Path(__file__).resolve().parents[2] / 'docs/system-design/capacity-model.json')
    parser.add_argument('--format', choices=['json', 'markdown'], default='json')
    args = parser.parse_args()
    result = estimate(json.loads(args.model.read_text(encoding='utf-8')))
    print(markdown(result) if args.format == 'markdown' else json.dumps(result, ensure_ascii=False, indent=2), end='\n' if args.format == 'json' else '')
