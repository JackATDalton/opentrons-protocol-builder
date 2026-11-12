from opentrons import protocol_api
metadata = {
    "protocolName": "Heatblock Cooling Test",
    "description": "A simple protocol to test the heatblock setup and precool it for experiments.",
    "author": "JATD"
}

requirements = {
    "robotType": "Flex", # Ensure the robot type is Flex,
    "apiLevel": "2.23",
    }


def run(protocol: protocol_api.ProtocolContext):
    temp_module = protocol.load_module(module_name="temperature module gen2", location="D1")
    temp_module.set_temperature(celsius=5)
   