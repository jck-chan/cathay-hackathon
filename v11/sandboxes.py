"""Registry of v11 simulations sharing a playback clock."""
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

from .conductor import Conductor, SimulationClock
from .dispatch_policies import DispatchModel, LABELS

DispatchPolicy = DispatchModel | Literal['fcfs', 'relay']


@dataclass(frozen=True)
class Sandbox:
    id: str
    name: str
    conductor: Conductor

    @property
    def policy(self) -> str:
        return self.conductor.lab.ground_policy

    @property
    def model(self) -> str:
        if self.policy == 'fcfs':
            return 'FCFS'
        if self.policy == 'relay':
            return 'RELAY_V11' if self.conductor.lab.v11_dispatch_enabled else 'RELAY_V10'
        return self.policy


class SandboxManager:
    def __init__(self, *sandboxes: Sandbox):
        self._sandboxes = {sandbox.id: sandbox for sandbox in sandboxes}
        self.clock = sandboxes[0].conductor.clock if sandboxes else SimulationClock()
        for sandbox in sandboxes[1:]:
            conductor = sandbox.conductor
            conductor.clock.detach(conductor)
            self.clock.attach(conductor)

    def create(self, name: str, *, policy: DispatchPolicy = 'relay', seed: int = 2048) -> Sandbox:
        name = name.strip()
        if not name:
            raise ValueError('Enter a sandbox name')
        if policy not in LABELS and policy not in ('fcfs', 'relay'):
            raise ValueError(f'Unknown dispatch policy: {policy}')
        with self.clock.guard:
            conductor = Conductor(seed=seed, dispatch_policies=(policy,), clock=self.clock)
            sandbox = Sandbox(uuid4().hex, name, conductor)
            self._sandboxes[sandbox.id] = sandbox
        return sandbox

    def get(self, sandbox_id: str) -> Sandbox:
        with self.clock.guard:
            return self._sandboxes[sandbox_id]

    def list(self) -> tuple[Sandbox, ...]:
        with self.clock.guard:
            return tuple(self._sandboxes.values())

    def delete(self, sandbox_id: str) -> None:
        with self.clock.guard:
            sandbox = self._sandboxes.pop(sandbox_id)
            sandbox.conductor.close()
